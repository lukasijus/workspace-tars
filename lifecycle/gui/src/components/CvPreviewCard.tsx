import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import type { Id } from "../types";

interface CvPreviewCardProps {
  artifactId?: Id | null;
  fileName?: string | null;
}

export function CvPreviewCard({ artifactId, fileName }: CvPreviewCardProps) {
  const artifactHref = artifactId ? `/artifacts/${artifactId}` : null;

  return (
    <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider", height: "100%" }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <PictureAsPdfOutlinedIcon color="primary" fontSize="small" />
            <Typography variant="h6">CV</Typography>
          </Stack>

          {artifactHref ? (
            <CardActionArea
              component="a"
              href={artifactHref}
              target="_blank"
              rel="noreferrer"
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                overflow: "hidden",
                bgcolor: "#f8fafc",
              }}
            >
              <Box
                component="iframe"
                title={fileName || "CV preview"}
                src={`${artifactHref}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                sx={{
                  display: "block",
                  width: "100%",
                  height: 230,
                  border: 0,
                  pointerEvents: "none",
                }}
              />
            </CardActionArea>
          ) : (
            <Box
              sx={{
                alignItems: "center",
                bgcolor: "#f8fafc",
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: 2,
                color: "text.secondary",
                display: "flex",
                height: 230,
                justifyContent: "center",
                px: 2,
                textAlign: "center",
              }}
            >
              No CV generated yet
            </Box>
          )}

          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={fileName || undefined}
            >
              {fileName || "No CV file"}
            </Typography>
            {artifactHref ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<OpenInNewOutlinedIcon />}
                href={artifactHref}
                target="_blank"
                rel="noreferrer"
              >
                Open CV
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
