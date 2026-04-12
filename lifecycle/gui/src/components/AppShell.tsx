import { useEffect, useState, type PropsWithChildren } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import EventRepeatOutlinedIcon from "@mui/icons-material/EventRepeatOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  AppBar,
  Box,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { fetchSchedulerStatus } from "../api/client";
import { isNavigationItemActive, navigationItems } from "../navigation";
import type { SchedulerStatus } from "../types";

const drawerWidth = 292;

function applicationIdFromPath(pathname: string) {
  const match = pathname.match(/^\/applications\/([^/]+)/);
  return match?.[1] || null;
}

function formatSchedulerTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function schedulerChipLabel(status: SchedulerStatus | null) {
  if (!status) return null;
  if (status.running && status.phase === "waiting") {
    return `Scheduler waiting ${status.completedRuns}/${status.totalRuns} · next ${formatSchedulerTime(status.nextRunAt)}`;
  }
  if (status.running) {
    return `Scheduler running ${status.currentRun || status.completedRuns + 1}/${status.totalRuns}`;
  }
  if (status.phase === "failed") {
    return "Scheduler failed";
  }
  return null;
}

export function AppShell({ children }: PropsWithChildren) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const currentApplicationId = applicationIdFromPath(location.pathname);
  const schedulerLabel = schedulerChipLabel(schedulerStatus);

  useEffect(() => {
    let cancelled = false;
    const loadSchedulerStatus = async () => {
      try {
        const nextStatus = await fetchSchedulerStatus();
        if (!cancelled) setSchedulerStatus(nextStatus);
      } catch {
        if (!cancelled) setSchedulerStatus(null);
      }
    };

    void loadSchedulerStatus();
    const timer = window.setInterval(() => void loadSchedulerStatus(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const drawerContent = (
    <Stack
      sx={{
        minHeight: "100%",
        p: 2,
        background:
          "linear-gradient(180deg, rgba(13, 23, 42, 0.96) 0%, rgba(22, 39, 68, 0.96) 52%, rgba(16, 78, 84, 0.96) 100%)",
        color: "common.white",
      }}
      spacing={2}
    >
      <Box sx={{ px: 1, py: 1.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: "-0.04em" }}>
          Tars
        </Typography>
        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.68)" }}>
          Lifecycle operator
        </Typography>
      </Box>

      <Divider sx={{ borderColor: "rgba(255,255,255,0.16)" }} />

      <List sx={{ p: 0 }}>
        {navigationItems.map((item) => {
          const selected = isNavigationItemActive(location.pathname, item);

          return (
            <ListItemButton
              key={item.path}
              selected={selected}
              onClick={() => handleNavigate(item.path)}
              sx={{
                mb: 0.25,
                minHeight: 42,
                borderLeft: "2px solid transparent",
                borderRadius: 1,
                color: "rgba(255,255,255,0.74)",
                px: 1.25,
                "&.Mui-selected": {
                  bgcolor: "rgba(255,255,255,0.08)",
                  borderLeftColor: "rgba(255,255,255,0.9)",
                  color: "common.white",
                },
                "&.Mui-selected:hover": {
                  bgcolor: "rgba(255,255,255,0.1)",
                },
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.06)",
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>
                {item.path === "/scheduler" ? (
                  <EventRepeatOutlinedIcon fontSize="small" />
                ) : (
                  <DashboardOutlinedIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {item.label}
                  </Typography>
                }
              />
            </ListItemButton>
          );
        })}
      </List>

      {currentApplicationId ? (
        <>
          <Divider sx={{ borderColor: "rgba(255,255,255,0.16)" }} />
          <Box
            sx={{
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 3,
              p: 1.5,
              bgcolor: "rgba(255,255,255,0.08)",
            }}
          >
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
              <AssignmentOutlinedIcon fontSize="small" />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 850 }}>
                  Application #{currentApplicationId}
                </Typography>
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                  Detail view
                </Typography>
              </Box>
            </Stack>
          </Box>
        </>
      ) : null}

      <Box sx={{ flexGrow: 1 }} />
    </Stack>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 6% 0%, rgba(40, 87, 197, 0.16), transparent 34%), linear-gradient(135deg, #eef2f5 0%, #f8fafc 52%, #edf4ef 100%)",
      }}
    >
      <AppBar
        elevation={0}
        position="fixed"
        sx={{
          display: { xs: "block", md: "none" },
          bgcolor: "rgba(248, 250, 252, 0.88)",
          color: "text.primary",
          backdropFilter: "blur(18px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar>
          <IconButton
            aria-label="Open navigation"
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1 }}
          >
            <MenuOutlinedIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Tars Lifecycle
          </Typography>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: drawerWidth,
              border: 0,
            },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: drawerWidth,
              border: 0,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Container
        maxWidth="xl"
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          pt: { xs: 10, md: 4 },
          pb: { xs: 3, md: 5 },
        }}
      >
        <Stack spacing={3}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography variant="h3" component="h1">
                Tars Lifecycle Dashboard
              </Typography>
              <Typography color="text.secondary">
                Local operator surface for approvals, latest workflow snapshots, and application health.
              </Typography>
            </Box>
            {schedulerLabel ? (
              <Chip
                clickable
                label={schedulerStatus?.cancelRequested ? "Scheduler stopping" : schedulerLabel}
                color={schedulerStatus?.phase === "failed" ? "error" : "info"}
                variant={schedulerStatus?.running ? "filled" : "outlined"}
                onClick={() => handleNavigate("/scheduler")}
              />
            ) : null}
          </Stack>
          {children}
        </Stack>
      </Container>
    </Box>
  );
}
