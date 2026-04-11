import { Box, Button, Stack } from "@mui/material";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import type { Id } from "../types";

interface ArtifactPreviewProps {
  imageArtifactId?: Id | null;
  htmlArtifactId?: Id | null;
  large?: boolean;
}

export function ArtifactPreview({
  imageArtifactId,
  htmlArtifactId,
  large = false,
}: ArtifactPreviewProps) {
  if (!imageArtifactId && !htmlArtifactId) return null;

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      {imageArtifactId ? (
        <Box
          component="a"
          href={`/artifacts/${imageArtifactId}`}
          target="_blank"
          rel="noreferrer"
          sx={{
            display: "block",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            overflow: "hidden",
            width: large ? 360 : 116,
            maxWidth: "100%",
            bgcolor: "grey.50",
          }}
        >
          <Box
            component="img"
            src={`/artifacts/${imageArtifactId}`}
            alt="Workflow snapshot"
            sx={{
              display: "block",
              width: "100%",
              height: large ? 230 : 72,
              objectFit: "cover",
            }}
          />
        </Box>
      ) : null}
      {htmlArtifactId ? (
        <Button
          size="small"
          variant="outlined"
          startIcon={<ArticleOutlinedIcon />}
          href={`/artifacts/${htmlArtifactId}`}
          target="_blank"
          rel="noreferrer"
        >
          HTML
        </Button>
      ) : null}
      {imageArtifactId ? (
        <Button
          size="small"
          variant="text"
          startIcon={<ImageOutlinedIcon />}
          href={`/artifacts/${imageArtifactId}`}
          target="_blank"
          rel="noreferrer"
        >
          Snapshot
        </Button>
      ) : null}
    </Stack>
  );
}
