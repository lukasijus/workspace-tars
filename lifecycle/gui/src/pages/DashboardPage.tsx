import { useEffect, useState } from "react";
import { Alert, Box, Grid, Paper, Snackbar, Stack, TextField, Select, MenuItem, InputLabel, FormControl } from "@mui/material";
import { ActionButton } from "../components/ActionButton";
import { ApplicationTable } from "../components/ApplicationTable";
import { MetricCard } from "../components/MetricCard";
import {
  fetchDashboard,
  fetchApplicationsList,
  retryDiscoveryAll,
  submitApproved,
} from "../api/client";
import type { DashboardData, ApplicationRow } from "../types";

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [listData, setListData] = useState<{ rows: ApplicationRow[]; total: number } | null>(null);
  
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterDate, setFilterDate] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const loadDashboard = async () => {
    setError(null);
    try {
      setData(await fetchDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  const loadList = async () => {
    setError(null);
    try {
      const response = await fetchApplicationsList({
        page: page + 1,
        limit: rowsPerPage,
        status: filterStatus || undefined,
        location: filterLocation || undefined,
        date: filterDate || undefined,
      });
      setListData({ rows: response.data, total: response.total });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      void loadList();
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [page, rowsPerPage, filterStatus, filterLocation, filterDate]);

  const runAction = async (action: "submit" | "retry") => {
    setLoadingAction(action);
    setError(null);
    try {
      if (action === "submit") {
        await submitApproved();
      } else {
        await retryDiscoveryAll();
      }
      await loadDashboard();
      await loadList();
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

      <Paper
        elevation={0}
        sx={{
          p: 2,
          border: "1px solid",
          borderColor: "divider",
          display: "flex",
          gap: 2,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="status-filter-label">Status</InputLabel>
          <Select
            labelId="status-filter-label"
            value={filterStatus}
            label="Status"
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(0);
            }}
          >
            <MenuItem value=""><em>Any Status</em></MenuItem>
            <MenuItem value="pending_approval">pending_approval</MenuItem>
            <MenuItem value="needs_human_input">needs_human_input</MenuItem>
            <MenuItem value="approved">approved</MenuItem>
            <MenuItem value="submitted">submitted</MenuItem>
            <MenuItem value="skipped">skipped</MenuItem>
            <MenuItem value="failed">failed</MenuItem>
          </Select>
        </FormControl>

        <TextField
          size="small"
          label="Location"
          variant="outlined"
          value={filterLocation}
          onChange={(e) => {
            setFilterLocation(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        />

        <TextField
          size="small"
          label="Date Created"
          type="date"
          variant="outlined"
          value={filterDate}
          onChange={(e) => {
            setFilterDate(e.target.value);
            setPage(0);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 200 }}
        />
      </Paper>

      <ApplicationTable 
        title="Application List" 
        rows={listData?.rows || []} 
        count={listData?.total || 0}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={(e, newPage) => setPage(newPage)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />

      <Snackbar open={Boolean(error)} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
