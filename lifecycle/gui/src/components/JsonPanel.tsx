import { Box, Typography } from "@mui/material";

interface JsonPanelProps {
  title: string;
  value: unknown;
}

export function JsonPanel({ title, value }: JsonPanelProps) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          borderRadius: 2,
          overflow: "auto",
          bgcolor: "#101826",
          color: "#eef6ff",
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {JSON.stringify(value, null, 2)}
      </Box>
    </Box>
  );
}
