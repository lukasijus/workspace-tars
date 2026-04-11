import { useEffect, useState } from "react";
import { Alert, Box, Grid, Paper, Snackbar, Stack } from "@mui/material";
import { ActionButton } from "../components/ActionButton";
import { ApplicationTable } from "../components/ApplicationTable";
import { MetricCard } from "../components/MetricCard";
import {
  fetchDashboard,
  retryDiscoveryAll,
  submitApproved,
} from "../api/client";
import type { DashboardData } from "../types";

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setData(await fetchDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runAction = async (action: "submit" | "retry") => {
    setLoadingAction(action);
    setError(null);
    try {
      if (action === "submit") {
        await submitApproved();
      } else {
        await retryDiscoveryAll();
      }
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setLoadingAction(null);
    }
  };

  const counts = data?.stats.applicationCounts || {};

  return (
    <Stack spacing={3}>
      <Paper
        elevation={0}
        sx={{
          p: 2,
          border: "1px solid",
          borderColor: "divider",
          display: "flex",
          gap: 1.5,
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Box color="text.secondary">
          Review, approve, retry discovery, and submit tracked applications.
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <ActionButton
            disabled={!data?.actions.retryableDiscoveryCount}
            loading={loadingAction === "retry"}
            variant="outlined"
            onClick={() => void runAction("retry")}
          >
            Retry discovery{data?.actions.retryableDiscoveryCount ? ` (${data.actions.retryableDiscoveryCount})` : ""}
          </ActionButton>
          <ActionButton
            color="success"
            disabled={!data?.actions.approvedCount}
            loading={loadingAction === "submit"}
            onClick={() => void runAction("submit")}
          >
            Submit approved{data?.actions.approvedCount ? ` (${data.actions.approvedCount})` : ""}
          </ActionButton>
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 3 }}>
          <MetricCard label="pending_approval" value={counts.pending_approval || 0} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <MetricCard label="needs_human_input" value={counts.needs_human_input || 0} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <MetricCard label="submitted_today" value={data?.stats.submittedToday || 0} />
        </Grid>
        <Grid size={{ xs: 12, md: 3 }}>
          <MetricCard label="failed_today" value={data?.stats.failedToday || 0} />
        </Grid>
      </Grid>

      <ApplicationTable title="Pending approval" rows={data?.pendingApproval || []} />
      <ApplicationTable title="Needs human input" rows={data?.needsHumanInput || []} />
      <ApplicationTable title="Recent applications" rows={data?.recentApplications || []} />

      <Snackbar open={Boolean(error)} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
