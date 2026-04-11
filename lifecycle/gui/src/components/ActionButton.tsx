import type { ReactNode } from "react";
import { Button, CircularProgress } from "@mui/material";

interface ActionButtonProps {
  children: ReactNode;
  color?: "primary" | "secondary" | "success" | "warning" | "error" | "inherit";
  disabled?: boolean;
  loading?: boolean;
  variant?: "text" | "outlined" | "contained";
  onClick: () => void;
}

export function ActionButton({
  children,
  color = "primary",
  disabled = false,
  loading = false,
  variant = "contained",
  onClick,
}: ActionButtonProps) {
  return (
    <Button
      color={color}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
      variant={variant}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
