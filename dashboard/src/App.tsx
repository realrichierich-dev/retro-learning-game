import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantProvider, useTenant } from "./contexts/TenantContext";
import Login from "./pages/Login";
import CreateOrg from "./pages/CreateOrg";
import DashboardShell from "./components/DashboardShell";
import Branding from "./pages/Branding";
import Uploads from "./pages/Uploads";

function Gate() {
  const { session, loading, tenant } = useTenant();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (!tenant) {
    return (
      <Routes>
        <Route path="*" element={<CreateOrg />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<DashboardShell />}>
        <Route path="/uploads" element={<Uploads />} />
        <Route path="/branding" element={<Branding />} />
        <Route path="*" element={<Navigate to="/uploads" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TenantProvider>
        <Gate />
      </TenantProvider>
    </BrowserRouter>
  );
}
