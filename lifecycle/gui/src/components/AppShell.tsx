import type { PropsWithChildren } from "react";
import { Box, Container, Stack, Typography } from "@mui/material";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 6% 0%, rgba(40, 87, 197, 0.16), transparent 34%), linear-gradient(135deg, #eef2f5 0%, #f8fafc 52%, #edf4ef 100%)",
        py: { xs: 2, md: 4 },
      }}
    >
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Box>
            <Typography variant="h3" component="h1">
              Tars Lifecycle Dashboard
            </Typography>
            <Typography color="text.secondary">
              Local operator surface for approvals, latest workflow snapshots, and application health.
            </Typography>
          </Box>
          {children}
        </Stack>
      </Container>
    </Box>
  );
}
