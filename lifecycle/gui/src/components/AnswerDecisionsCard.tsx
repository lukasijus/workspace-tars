import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import type { AnswerDecisionRow } from "../types";

interface AnswerDecisionsCardProps {
  decisions: AnswerDecisionRow[];
}

function formatConfidence(value: AnswerDecisionRow["confidence"]) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return `${Math.round(numeric * 100)}%`;
}

export function AnswerDecisionsCard({ decisions }: AnswerDecisionsCardProps) {
  const latest = decisions.slice(0, 8);

  return (
    <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider" }}>
      <CardContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Answer decisions</Typography>
            <Typography variant="body2" color="text.secondary">
              Field answers inferred from applicant facts, policy, or the dossier.
            </Typography>
          </Box>

          {latest.length ? (
            <Stack divider={<Divider flexItem />} spacing={1.5}>
              {latest.map((decision) => (
                <Stack key={String(decision.id)} spacing={0.75}>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                    <Chip
                      size="small"
                      color={decision.should_auto_fill ? "success" : "default"}
                      label={decision.should_auto_fill ? "auto-fill" : "review"}
                      variant={decision.should_auto_fill ? "filled" : "outlined"}
                    />
                    {decision.risk_level ? (
                      <Chip size="small" label={decision.risk_level} variant="outlined" />
                    ) : null}
                    {decision.resolver_mode ? (
                      <Chip size="small" label={decision.resolver_mode} variant="outlined" />
                    ) : null}
                    <Chip size="small" label={`confidence ${formatConfidence(decision.confidence)}`} variant="outlined" />
                  </Stack>
                  <Typography variant="subtitle2">
                    {decision.field_label || decision.question_text || decision.question_key}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Answer:</strong> {decision.answer || "n/a"}
                  </Typography>
                  {decision.reason ? (
                    <Typography variant="body2" color="text.secondary">
                      {decision.reason}
                    </Typography>
                  ) : null}
                  {decision.source_evidence ? (
                    <Typography variant="caption" color="text.secondary">
                      Evidence: {decision.source_evidence}
                    </Typography>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">No answer decisions captured yet.</Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
