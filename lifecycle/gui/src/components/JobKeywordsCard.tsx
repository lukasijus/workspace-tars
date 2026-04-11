import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import type { JobKeywordExtraction } from "../types";

interface JobKeywordsCardProps {
  descriptionText?: string | null;
  extractedAt?: string | null;
  extraction?: JobKeywordExtraction | null;
  status?: string | null;
}

const groups: Array<[keyof JobKeywordExtraction, string]> = [
  ["matchedCandidateStrengths", "Candidate match"],
  ["atsKeywords", "ATS keywords"],
  ["hardSkills", "Hard skills"],
  ["frameworks", "Frameworks"],
  ["tools", "Tools"],
  ["domains", "Domains"],
  ["responsibilities", "Responsibilities"],
  ["mustHave", "Must-have signals"],
  ["niceToHave", "Nice-to-have signals"],
];

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function ChipGroup({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 0.75 }}>
        {values.slice(0, 18).map((value) => (
          <Chip key={value} size="small" label={value} variant="outlined" />
        ))}
      </Stack>
    </Box>
  );
}

export function JobKeywordsCard({
  descriptionText,
  extractedAt,
  extraction,
  status,
}: JobKeywordsCardProps) {
  const hasExtraction = groups.some(([key]) => asStrings(extraction?.[key]).length > 0);
  const preview = String(descriptionText || "").trim();

  return (
    <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider" }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography variant="h6">Job keywords</Typography>
              <Typography variant="body2" color="text.secondary">
                Expanded job description and CV tailoring signals.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              {status ? <Chip size="small" label={status} variant="outlined" /> : null}
              {extraction?.source ? <Chip size="small" label={extraction.source} variant="outlined" /> : null}
            </Stack>
          </Stack>

          {hasExtraction ? (
            <Stack spacing={1.5}>
              {groups.map(([key, label]) => (
                <ChipGroup key={String(key)} label={label} values={asStrings(extraction?.[key])} />
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">No keyword extraction captured yet.</Typography>
          )}

          {preview ? (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Description preview{extractedAt ? ` · extracted ${extractedAt}` : ""}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.75,
                    maxHeight: 170,
                    overflow: "auto",
                    pr: 1,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {preview}
                </Typography>
              </Box>
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
