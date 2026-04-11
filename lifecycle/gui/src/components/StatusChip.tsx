import { Chip } from "@mui/material";

const colorByStatus: Record<string, "default" | "primary" | "success" | "warning" | "error" | "info"> = {
  approved: "success",
  failed: "error",
  needs_human_input: "warning",
  pending_approval: "primary",
  skipped: "default",
  submitted: "success",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      label={status}
      color={colorByStatus[status] || "default"}
      variant={status === "submitted" ? "filled" : "outlined"}
    />
  );
}
