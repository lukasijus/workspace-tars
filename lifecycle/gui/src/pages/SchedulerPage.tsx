import { Fragment, useEffect, useState } from "react";
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import KeyboardArrowRightOutlinedIcon from "@mui/icons-material/KeyboardArrowRightOutlined";
import {
  Alert,
  Box,
  Chip,
  Collapse,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { ActionButton } from "../components/ActionButton";
import {
  cancelScheduler,
  fetchSchedulerStatus,
  startScheduler,
} from "../api/client";
import type { Id, SchedulerPersistedRun, SchedulerRunRecord, SchedulerStatus } from "../types";

const RUN_COUNT_OPTIONS = [1, 2, 3, 4, 5, 10];
const ITEMS_PER_RUN_OPTIONS = [1, 3, 5, 10, 15, 20];
const GAP_MINUTE_OPTIONS = [5, 10, 15, 30, 60];

function formatDateTime(value?: string | null) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function phaseColor(phase: SchedulerStatus["phase"]): "default" | "info" | "success" | "warning" | "error" {
  if (phase === "failed") return "error";
  if (phase === "cancelled" || phase === "interrupted") return "warning";
  if (phase === "completed") return "success";
  if (phase === "running" || phase === "waiting") return "info";
  return "default";
}

function runStatusColor(status: SchedulerRunRecord["status"]): "default" | "info" | "success" | "warning" | "error" {
  if (status === "failed") return "error";
  if (status === "interrupted") return "warning";
  if (status === "succeeded") return "success";
  if (status === "running") return "info";
  return "default";
}

function formatDurationMs(value?: number | null) {
  if (value === null || value === undefined) return "n/a";
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatDurationBetween(start?: string | null, end?: string | null) {
  if (!start) return "n/a";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return "n/a";
  return formatDurationMs(endMs - startMs);
}

function statusText(status: SchedulerStatus | null) {
  if (!status) return "Status unavailable";
  if (status.running && status.phase === "waiting") {
    return `Waiting for run ${status.completedRuns + 1}/${status.totalRuns}`;
  }
  if (status.running) {
    return `Running ${status.currentRun || status.completedRuns + 1}/${status.totalRuns}`;
  }
  return status.phase;
}

export function SchedulerPage() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [runCount, setRunCount] = useState(3);
  const [itemsPerRun, setItemsPerRun] = useState(5);
  const [gapMinutes, setGapMinutes] = useState(10);
  const [loadingAction, setLoadingAction] = useState<"start" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<Id | null>(null);

  const load = async () => {
    try {
      setStatus(await fetchSchedulerStatus());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleStart = async () => {
    setLoadingAction("start");
    setError(null);
    try {
      setStatus(await startScheduler({ runCount, itemsPerRun, gapMinutes }));
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCancel = async () => {
    setLoadingAction("cancel");
    setError(null);
    try {
      setStatus(await cancelScheduler());
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setLoadingAction(null);
    }
  };

  const persistedRuns = status?.persistedRuns || [];
  const isExpanded = (run: SchedulerPersistedRun) =>
    expandedRunId !== null && String(expandedRunId) === String(run.id);

  return (
    <Stack spacing={3}>
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5">Scheduler</Typography>
            <Typography color="text.secondary">
              Run the lifecycle search batch repeatedly with a fixed item limit per run.
            </Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                select
                label="Scheduler runs"
                value={runCount}
                disabled={Boolean(status?.running)}
                onChange={(event) => setRunCount(Number(event.target.value))}
              >
                {RUN_COUNT_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                select
                label="Items per run"
                value={itemsPerRun}
                disabled={Boolean(status?.running)}
                onChange={(event) => setItemsPerRun(Number(event.target.value))}
              >
                {ITEMS_PER_RUN_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                select
                label="Gap between runs"
                value={gapMinutes}
                disabled={runCount <= 1 || Boolean(status?.running)}
                helperText={runCount <= 1 ? "Only used when runs > 1" : "Minutes"}
                onChange={(event) => setGapMinutes(Number(event.target.value))}
              >
                {GAP_MINUTE_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option} minutes
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <ActionButton
              loading={loadingAction === "start"}
              disabled={Boolean(status?.running)}
              onClick={() => void handleStart()}
            >
              Start scheduler
            </ActionButton>
            <ActionButton
              variant="outlined"
              color="warning"
              loading={loadingAction === "cancel"}
              disabled={!status?.running || status.cancelRequested}
              onClick={() => void handleCancel()}
            >
              Stop after current run
            </ActionButton>
          </Stack>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography variant="h5">Current status</Typography>
              <Typography color="text.secondary">{statusText(status)}</Typography>
            </Box>
            {status ? (
              <Chip
                label={status.cancelRequested ? "cancelling" : status.phase}
                color={status.cancelRequested ? "warning" : phaseColor(status.phase)}
                variant={status.running ? "filled" : "outlined"}
              />
            ) : null}
          </Stack>

          {status?.running ? <LinearProgress /> : null}
          {status?.lastError ? <Alert severity="error">{status.lastError}</Alert> : null}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 3 }}>
              <Typography variant="caption" color="text.secondary">Progress</Typography>
              <Typography>
                {status?.totalRuns ? `${status.completedRuns}/${status.totalRuns}` : "n/a"}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <Typography variant="caption" color="text.secondary">Items per run</Typography>
              <Typography>{status?.itemsPerRun || "n/a"}</Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <Typography variant="caption" color="text.secondary">Started</Typography>
              <Typography>{formatDateTime(status?.startedAt)}</Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <Typography variant="caption" color="text.secondary">Next run</Typography>
              <Typography>{formatDateTime(status?.nextRunAt)}</Typography>
            </Grid>
          </Grid>

          <Divider />

          <Box>
            <Typography variant="h6" gutterBottom>Run history</Typography>
            {persistedRuns.length ? (
              <TableContainer component={Paper} variant="outlined" sx={{ borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 48 }} />
                      <TableCell>Progress</TableCell>
                      <TableCell>Items per run</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell>Next run</TableCell>
                      <TableCell>Total time</TableCell>
                      <TableCell>End time</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {persistedRuns.map((run) => (
                      <Fragment key={String(run.id)}>
                        <TableRow
                          hover
                          onClick={() => setExpandedRunId(isExpanded(run) ? null : run.id)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>
                            <IconButton aria-label="Toggle child runs" size="small">
                              {isExpanded(run) ? (
                                <KeyboardArrowDownOutlinedIcon fontSize="small" />
                              ) : (
                                <KeyboardArrowRightOutlinedIcon fontSize="small" />
                              )}
                            </IconButton>
                          </TableCell>
                          <TableCell>{run.completedRuns}/{run.totalRuns}</TableCell>
                          <TableCell>{run.itemsPerRun}</TableCell>
                          <TableCell>{formatDateTime(run.startedAt)}</TableCell>
                          <TableCell>{formatDateTime(run.nextRunAt)}</TableCell>
                          <TableCell>
                            {formatDurationBetween(
                              run.startedAt,
                              run.finishedAt || (run.status === "running" || run.status === "waiting" ? null : run.startedAt),
                            )}
                          </TableCell>
                          <TableCell>{formatDateTime(run.finishedAt)}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={run.cancelRequested && run.status !== "cancelled" ? "cancelling" : run.status}
                              color={run.cancelRequested && run.status !== "cancelled" ? "warning" : phaseColor(run.status)}
                              variant={run.status === "completed" ? "filled" : "outlined"}
                            />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={8} sx={{ p: 0, border: 0 }}>
                            <Collapse in={isExpanded(run)} timeout="auto" unmountOnExit>
                              <Box sx={{ p: 2, bgcolor: "#f8fafc" }}>
                                {run.lastError ? (
                                  <Alert severity="error" sx={{ mb: 2 }}>
                                    {run.lastError}
                                  </Alert>
                                ) : null}
                                {run.items.length ? (
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Run</TableCell>
                                        <TableCell>Worker run</TableCell>
                                        <TableCell>Started</TableCell>
                                        <TableCell>End time</TableCell>
                                        <TableCell>Duration</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Error</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {run.items.map((item) => (
                                        <TableRow key={String(item.id)}>
                                          <TableCell>{item.runNumber}</TableCell>
                                          <TableCell>{item.workerRunId || "n/a"}</TableCell>
                                          <TableCell>{formatDateTime(item.startedAt)}</TableCell>
                                          <TableCell>{formatDateTime(item.finishedAt)}</TableCell>
                                          <TableCell>{formatDurationMs(item.durationMs)}</TableCell>
                                          <TableCell>
                                            <Chip
                                              size="small"
                                              label={item.status}
                                              color={runStatusColor(item.status)}
                                              variant="outlined"
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <Typography
                                              variant="body2"
                                              color={item.error ? "error" : "text.secondary"}
                                              sx={{
                                                maxWidth: 360,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                              }}
                                            >
                                              {item.error || "n/a"}
                                            </Typography>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <Typography color="text.secondary">No child batch runs recorded.</Typography>
                                )}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography color="text.secondary">No scheduler runs yet.</Typography>
            )}
          </Box>
        </Stack>
      </Paper>

      <Snackbar open={Boolean(error)} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
