// Who sees what: signed out → sign in; signed in without a team → join a team
// (and wait for approval); in a team → the picker, the games and the team's
// history. The admin also has /admin.
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { CircleUserRound, History, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { useApp } from "./lib/store.ts";
import { AuthPage } from "./pages/AuthPage.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { PickerPage } from "./pages/PickerPage.tsx";
import { AdminPage } from "./pages/AdminPage.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { ChoosePage } from "./pages/ChoosePage.tsx";
import { WheelPage } from "./pages/WheelPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";

export function App() {
  const status = useApp((s) => s.status);
  const profile = useApp((s) => s.profile);
  const team = useApp((s) => s.team);
  if (status === "loading") return <div className="splash"><span className="loading-dots"><i /><i /><i /></span></div>;
  if (status === "signedOut") return <AuthPage />;
  if (!profile) return <div className="splash"><p>Your account is not set up yet. Reload the page in a moment.</p></div>;
  return (
    <div className="shell">
      <TopBar />
      <Routes>
        <Route path="/admin" element={profile.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/choose" element={team ? <ChoosePage /> : <Navigate to="/" replace />} />
        <Route path="/choose/wheel" element={team ? <WheelPage /> : <Navigate to="/" replace />} />
        <Route path="/history" element={team ? <HistoryPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={team ? <PickerPage /> : <JoinPage />} />
      </Routes>
    </div>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark"><UtensilsCrossed size={16} aria-hidden="true" /></span>
      <span>MFT Lunch Picker</span>
    </span>
  );
}

function TopBar() {
  const profile = useApp((s) => s.profile)!;
  const team = useApp((s) => s.team);
  const pending = useApp((s) => s.pending);
  return (
    <header className="topbar">
      <NavLink to="/" className="topbar-home" aria-label="MFT Lunch Picker, today's list"><Brand /></NavLink>
      {team && <span className="team-chip">{team.name}</span>}
      <nav className="topbar-nav">
        {team && (
          <NavLink to="/history" className="topbar-link" aria-label="History">
            <History size={18} aria-hidden="true" /><span className="hide-narrow">History</span>
          </NavLink>
        )}
        {profile.role === "admin" && (
          <NavLink to="/admin" className="topbar-link">
            <ShieldCheck size={18} aria-hidden="true" /><span className="hide-narrow">Admin</span>
            {pending > 0 && <span className="count" aria-label={`${pending} waiting for approval`}>{pending}</span>}
          </NavLink>
        )}
        <NavLink to="/account" className="topbar-link" aria-label="Your account">
          <CircleUserRound size={18} aria-hidden="true" /><span className="hide-narrow">{profile.display_name || "Account"}</span>
        </NavLink>
      </nav>
    </header>
  );
}
