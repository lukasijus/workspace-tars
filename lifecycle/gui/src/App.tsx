import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ApplicationPage } from "./pages/ApplicationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SchedulerPage } from "./pages/SchedulerPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/scheduler" element={<SchedulerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/applications/:id" element={<ApplicationPage />} />
      </Routes>
    </AppShell>
  );
}
