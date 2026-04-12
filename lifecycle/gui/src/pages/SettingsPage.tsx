import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Snackbar, Stack, TextField, Typography } from "@mui/material";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { fetchSettings, saveSettings } from "../api/client";
import type { SettingsPayload } from "../types";

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [originalSettings, setOriginalSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((data: SettingsPayload) => {
        setSettings(data);
        setOriginalSettings(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveSettings(settings);
      setSettings(result);
      setOriginalSettings(result);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = 
    originalSettings &&
    settings &&
    (originalSettings.applicantFacts !== settings.applicantFacts ||
      originalSettings.applicantPolicy !== settings.applicantPolicy ||
      originalSettings.applicantProfile !== settings.applicantProfile);

  if (loading) {
    return <CircularProgress />;
  }

  if (!settings) {
    return <Alert severity="error">{error || "Failed to load settings."}</Alert>;
  }

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}
      
      <Box>
        <Typography variant="h6" gutterBottom>
          Applicant Policy (JSON)
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Rules for automatic processing and approvals.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={5}
          maxRows={15}
          value={settings.applicantPolicy}
          onChange={(e) => setSettings({ ...settings, applicantPolicy: e.target.value })}
          sx={{ "& .MuiInputBase-input": { fontFamily: "monospace", fontSize: "0.875rem" } }}
        />
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Applicant Facts (JSON)
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Structured data for deterministic form filling.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={5}
          maxRows={15}
          value={settings.applicantFacts}
          onChange={(e) => setSettings({ ...settings, applicantFacts: e.target.value })}
          sx={{ "& .MuiInputBase-input": { fontFamily: "monospace", fontSize: "0.875rem" } }}
        />
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          Applicant Profile (Markdown)
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Unstructured dossier used by LLM to answer complex questions.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={5}
          maxRows={15}
          value={settings.applicantProfile}
          onChange={(e) => setSettings({ ...settings, applicantProfile: e.target.value })}
          sx={{ "& .MuiInputBase-input": { fontFamily: "monospace", fontSize: "0.875rem" } }}
        />
      </Box>

      <Box>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </Box>

      <Snackbar
        open={success}
        autoHideDuration={3000}
        onClose={() => setSuccess(false)}
        message="Settings saved successfully."
      />
    </Stack>
  );
}
