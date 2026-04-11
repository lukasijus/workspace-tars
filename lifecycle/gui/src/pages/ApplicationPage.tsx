import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Breadcrumbs,
  Card,
  CardContent,
  Divider,
  Grid,
  Link,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ActionButton } from "../components/ActionButton";
import { ArtifactPreview } from "../components/ArtifactPreview";
import { JsonPanel } from "../components/JsonPanel";
import { StatusChip } from "../components/StatusChip";
import {
  approveApplication,
  fetchApplication,
  markInactive,
  markSubmitted,
  rejectApplication,
  retryDiscovery,
  submitOne,
} from "../api/client";
import type { ApplicationDetail } from "../types";

function externalStepSummary(detail: ApplicationDetail) {
  const externalStep = detail.application.draft_payload?.externalStep as Record<string, unknown> | undefined;
  const unresolvedFields = detail.application.draft_payload?.unresolvedFields as unknown[] | undefined;

  if (!externalStep && !unresolvedFields?.length) return null;

  return {
    providerHint: externalStep?.providerHint,
    stepTitle: externalStep?.stepTitle,
    url: externalStep?.url,
    unresolvedFields,
    validationErrors: externalStep?.validationErrors,
    buttons: externalStep?.buttons,
  };
}

export function ApplicationPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [inactiveReason, setInactiveReason] = useState("");

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      setDetail(await fetchApplication(id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const runAction = async (action: string, callback: () => Promise<unknown>) => {
    setLoadingAction(action);
    setError(null);
    try {
      await callback();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setLoadingAction(null);
    }
  };

  if (!detail || !id) {
    return error ? <Alert severity="error">{error}</Alert> : <Alert severity="info">Loading application…</Alert>;
  }

  const app = detail.application;
  const summary = externalStepSummary(detail);

  return (
    <Stack spacing={3}>
      <Breadcrumbs>
        <Link component={RouterLink} to="/">
          Dashboard
        </Link>
        <Typography color="text.primary">Application {String(app.id)}</Typography>
      </Breadcrumbs>

      <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider" }}>
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h4">
                {app.company || "Unknown company"} — {app.title || "Unknown role"}
              </Typography>
              <Typography color="text.secondary">{app.location || "Unknown location"}</Typography>
            </Box>

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <StatusChip status={app.status} />
              <StatusChip status={app.flow_type || "unknown"} />
              <StatusChip status={app.approval_state || "none"} />
              {app.is_active === false ? <StatusChip status="inactive" /> : null}
            </Stack>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2">
                  <strong>Submitted at:</strong> {app.submitted_at || "n/a"}
                </Typography>
                <Typography variant="body2">
                  <strong>Submission attempted at:</strong> {app.submission_attempted_at || "n/a"}
                </Typography>
                <Typography variant="body2">
                  <strong>CV:</strong> {app.cv_variant_file_name || "n/a"}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2">
                  <strong>Reason:</strong> {app.inactive_reason || app.last_error || app.summary_reason || "n/a"}
                </Typography>
                <Typography variant="body2">
                  <strong>Source:</strong>{" "}
                  {app.source_url ? (
                    <Link href={app.source_url} target="_blank" rel="noreferrer">
                      open source
                    </Link>
                  ) : (
                    "n/a"
                  )}
                </Typography>
                <Typography variant="body2">
                  <strong>External apply:</strong>{" "}
                  {app.external_apply_url ? (
                    <Link href={app.external_apply_url} target="_blank" rel="noreferrer">
                      open apply URL
                    </Link>
                  ) : (
                    "n/a"
                  )}
                </Typography>
              </Grid>
            </Grid>

            <Divider />

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <ActionButton
                disabled={!detail.availableActions.approve}
                loading={loadingAction === "approve"}
                color="success"
                onClick={() => void runAction("approve", () => approveApplication(id))}
              >
                Approve
              </ActionButton>
              <ActionButton
                disabled={!detail.availableActions.submitNow}
                loading={loadingAction === "submit"}
                color="success"
                variant="outlined"
                onClick={() => void runAction("submit", () => submitOne(id))}
              >
                Submit now
              </ActionButton>
              <ActionButton
                disabled={!detail.availableActions.retryDiscovery}
                loading={loadingAction === "retry"}
                variant="outlined"
                onClick={() => void runAction("retry", () => retryDiscovery(id))}
              >
                Retry discovery
              </ActionButton>
              <ActionButton
                disabled={!detail.availableActions.markSubmitted}
                loading={loadingAction === "markSubmitted"}
                color="secondary"
                variant="outlined"
                onClick={() => void runAction("markSubmitted", () => markSubmitted(id))}
              >
                Mark submitted
              </ActionButton>
              <ActionButton
                disabled={!detail.availableActions.reject}
                loading={loadingAction === "reject"}
                color="error"
                variant="outlined"
                onClick={() => void runAction("reject", () => rejectApplication(id))}
              >
                Reject
              </ActionButton>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="Inactive reason"
                value={inactiveReason}
                onChange={(event) => setInactiveReason(event.target.value)}
              />
              <ActionButton
                disabled={!detail.availableActions.markInactive}
                loading={loadingAction === "inactive"}
                color="error"
                variant="outlined"
                onClick={() => void runAction("inactive", () => markInactive(id, inactiveReason))}
              >
                Mark inactive
              </ActionButton>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider", height: "100%" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Latest snapshot
              </Typography>
              <ArtifactPreview
                large
                imageArtifactId={detail.latestImageArtifact?.id}
                htmlArtifactId={detail.latestHtmlArtifact?.id}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <JsonPanel title="Latest external step" value={summary || "No external step captured"} />
        </Grid>
      </Grid>

      <JsonPanel title="Artifacts" value={detail.artifacts} />
      <JsonPanel title="Steps" value={detail.steps} />
      <JsonPanel title="Draft payload" value={app.draft_payload || {}} />
      <JsonPanel title="Discovered fields" value={app.discovered_fields || []} />

      <Snackbar open={Boolean(error)} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
