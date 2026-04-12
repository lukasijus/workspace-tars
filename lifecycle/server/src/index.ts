import express, { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./httpError";
import { applicantFactsModule, applicantPolicyModule, config, db, guiDistRoot } from "./legacy";
import {
  approveApplication,
  assertArtifactReadable,
  fetchApplication,
  fetchArtifactRow,
  fetchDashboard,
  getPaginatedApplications,
  inferMimeType,
  markInactive,
  markSubmitted,
  rejectApplication,
  retryDiscovery,
  retryDiscoveryAll,
  submitApproved,
} from "./dashboardService";
import {
  cancelScheduler,
  getSchedulerStatus,
  initializeSchedulerHistory,
  shutdownScheduler,
  startScheduler,
} from "./schedulerService";

const { applyMigrations, closePool } = db;

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function reasonFromBody(request: Request): string | undefined {
  const value = request.body?.reason;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function idParam(request: Request): string {
  const value = request.params.id;
  return Array.isArray(value) ? value[0] : value;
}

function sendJsonError(response: Response, error: unknown) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Unknown server error";

  response.status(statusCode).json({
    ok: false,
    error: message,
    details: error instanceof HttpError ? error.details : undefined,
  });
}

function sendLocalFile(response: Response, filePath: string) {
  return new Promise<void>((resolve, reject) => {
    response.sendFile(filePath, { dotfiles: "allow" }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function createApp() {
  await applyMigrations();
  await initializeSchedulerHistory();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));
  app.use(express.urlencoded({ extended: false, limit: "512kb" }));

  app.get("/api/dashboard", asyncRoute(async (_request, response) => {
    response.json(await fetchDashboard());
  }));

  app.get("/api/applications", asyncRoute(async (request, response) => {
    response.json(
      await getPaginatedApplications({
        page: request.query.page ? Number(request.query.page) : undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        status: request.query.status as string | undefined,
        location: request.query.location as string | undefined,
        date: request.query.date as string | undefined,
      }),
    );
  }));

  app.get("/api/settings", asyncRoute(async (_request, response) => {
    const applicantFacts = fs.existsSync(config.applicantFactsPath)
      ? fs.readFileSync(config.applicantFactsPath, "utf8")
      : "";
    const applicantPolicy = fs.existsSync(config.applicantPolicyPath)
      ? fs.readFileSync(config.applicantPolicyPath, "utf8")
      : "";
    const applicantProfile = fs.existsSync(config.applicantProfilePath)
      ? fs.readFileSync(config.applicantProfilePath, "utf8")
      : "";

    response.json({
      ok: true,
      settings: {
        applicantFacts,
        applicantPolicy,
        applicantProfile,
      },
    });
  }));

  app.post("/api/settings", asyncRoute(async (request, response) => {
    const { applicantFacts, applicantPolicy, applicantProfile } = request.body;

    if (typeof applicantFacts === "string") {
      try {
        JSON.parse(applicantFacts);
      } catch (err: any) {
        throw new HttpError(400, `Invalid JSON in Applicant Facts: ${err.message}`);
      }
      fs.writeFileSync(config.applicantFactsPath, applicantFacts, "utf8");
      config.applicantFacts = applicantFactsModule.loadApplicantFacts(
        config.applicantFactsPath,
      );
    }

    if (typeof applicantPolicy === "string") {
      try {
        JSON.parse(applicantPolicy);
      } catch (err: any) {
        throw new HttpError(400, `Invalid JSON in Applicant Policy: ${err.message}`);
      }
      fs.writeFileSync(config.applicantPolicyPath, applicantPolicy, "utf8");
      config.applicantPolicy = applicantPolicyModule.loadApplicantPolicy(
        config.applicantPolicyPath,
      );
    }

    if (typeof applicantProfile === "string") {
      fs.writeFileSync(config.applicantProfilePath, applicantProfile, "utf8");
      config.applicantProfileText = applicantProfile;
    }

    response.json({
      ok: true,
      settings: {
        applicantFacts: fs.existsSync(config.applicantFactsPath)
          ? fs.readFileSync(config.applicantFactsPath, "utf8")
          : "",
        applicantPolicy: fs.existsSync(config.applicantPolicyPath)
          ? fs.readFileSync(config.applicantPolicyPath, "utf8")
          : "",
        applicantProfile: fs.existsSync(config.applicantProfilePath)
          ? fs.readFileSync(config.applicantProfilePath, "utf8")
          : "",
      },
    });
  }));

  app.get("/api/scheduler", asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      scheduler: await getSchedulerStatus(),
    });
  }));

  app.post("/api/scheduler/start", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      scheduler: await startScheduler(request.body || {}),
    });
  }));

  app.post("/api/scheduler/cancel", asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      scheduler: await cancelScheduler(),
    });
  }));

  app.get("/api/applications/:id", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      detail: await fetchApplication(idParam(request)),
    });
  }));

  app.post("/api/submit-approved", asyncRoute(async (_request, response) => {
    response.json(await submitApproved());
  }));

  app.post("/api/retry-discovery-all", asyncRoute(async (_request, response) => {
    response.json(await retryDiscoveryAll());
  }));

  app.post("/api/applications/:id/approve", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      detail: await approveApplication(idParam(request), reasonFromBody(request)),
    });
  }));

  app.post("/api/applications/:id/reject", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      detail: await rejectApplication(idParam(request), reasonFromBody(request)),
    });
  }));

  app.post("/api/applications/:id/retry-discovery", asyncRoute(async (request, response) => {
    response.json(await retryDiscovery(idParam(request)));
  }));

  app.post("/api/applications/:id/mark-inactive", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      detail: await markInactive(idParam(request), reasonFromBody(request)),
    });
  }));

  app.post("/api/applications/:id/mark-submitted", asyncRoute(async (request, response) => {
    response.json({
      ok: true,
      detail: await markSubmitted(idParam(request), reasonFromBody(request)),
    });
  }));

  app.post("/api/applications/:id/submit", asyncRoute(async (request, response) => {
    response.json(await submitApproved(idParam(request)));
  }));

  app.get("/artifacts/:id", asyncRoute(async (request, response) => {
    const artifact = await fetchArtifactRow(idParam(request));
    if (!artifact) {
      throw new HttpError(404, "Artifact not found.");
    }

    assertArtifactReadable(artifact);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.type(artifact.mime_type || inferMimeType(artifact.file_path));
    await sendLocalFile(response, path.resolve(artifact.file_path));
  }));

  if (fs.existsSync(guiDistRoot)) {
    app.use(express.static(guiDistRoot, {
      etag: true,
      fallthrough: true,
      maxAge: "1h",
    }));

    app.get(/^(?!\/api\/|\/artifacts\/).*/, asyncRoute(async (_request, response) => {
      await sendLocalFile(response, path.join(guiDistRoot, "index.html"));
    }));
  } else {
    app.get(/^(?!\/api\/|\/artifacts\/).*/, (_request, response) => {
      response.status(503).type("text/plain").send(
        [
          "Tars dashboard GUI build is missing.",
          "Run: npm --prefix lifecycle/gui run build",
          "Then restart scripts/tars-lifecycle-dashboard.sh.",
        ].join("\n"),
      );
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendJsonError(response, error);
  });

  return app;
}

async function main() {
  const app = await createApp();
  const server = app.listen(config.dashboardPort, config.dashboardHost, () => {
    console.log(JSON.stringify({
      ok: true,
      action: "dashboard",
      stack: "express-react-typescript",
      host: config.dashboardHost,
      port: config.dashboardPort,
      url: `http://${config.dashboardHost}:${config.dashboardPort}/`,
    }, null, 2));
  });

  const shutdown = async () => {
    await shutdownScheduler();
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    ok: false,
    action: "dashboard",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  await closePool().catch(() => {});
  process.exit(1);
});
