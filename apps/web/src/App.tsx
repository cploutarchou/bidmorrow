import type { ReactElement } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { MarketingLayout } from './components/MarketingLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminGate } from './components/admin/AdminGate';
import { AuthProvider } from './lib/auth-context';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { Login } from './pages/auth/Login';
import { ResetPassword } from './pages/auth/ResetPassword';
import { Signup } from './pages/auth/Signup';
import { VerifyEmail } from './pages/auth/VerifyEmail';
import { Contact } from './pages/marketing/Contact';
import { Home } from './pages/marketing/Home';
import { HowItWorks } from './pages/marketing/HowItWorks';
import { Methodology } from './pages/marketing/Methodology';
import { Pilot } from './pages/marketing/Pilot';
import { Pricing } from './pages/marketing/Pricing';
import { Privacy } from './pages/marketing/Privacy';
import { Terms } from './pages/marketing/Terms';
import { BillingSuccess } from './pages/app/BillingSuccess';
import { Feed } from './pages/app/Feed';
import { Onboarding } from './pages/app/Onboarding';
import { Settings } from './pages/app/Settings';
import { TenderDetail } from './pages/app/TenderDetail';
import { NotFound } from './pages/NotFound';
import { Dashboard as AdminDashboard } from './pages/admin/Dashboard';
import { Organizations as AdminOrganizations } from './pages/admin/Organizations';
import { OrganizationDetail as AdminOrganizationDetail } from './pages/admin/OrganizationDetail';
import { Users as AdminUsers } from './pages/admin/Users';
import { Subscriptions as AdminSubscriptions } from './pages/admin/Subscriptions';
import { Ingestion as AdminIngestion } from './pages/admin/Ingestion';
import { Matching as AdminMatching } from './pages/admin/Matching';
import { Digest as AdminDigest } from './pages/admin/Digest';
import { Support as AdminSupport } from './pages/admin/Support';
import { Audit as AdminAudit } from './pages/admin/Audit';
import { Flags as AdminFlags } from './pages/admin/Flags';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <MarketingLayout fullBleed>
                <Home />
              </MarketingLayout>
            }
          />
          <Route
            path="/pricing"
            element={
              <MarketingLayout>
                <Pricing />
              </MarketingLayout>
            }
          />
          <Route
            path="/how-it-works"
            element={
              <MarketingLayout>
                <HowItWorks />
              </MarketingLayout>
            }
          />
          <Route
            path="/methodology"
            element={
              <MarketingLayout>
                <Methodology />
              </MarketingLayout>
            }
          />
          <Route
            path="/pilot"
            element={
              <MarketingLayout>
                <Pilot />
              </MarketingLayout>
            }
          />
          <Route
            path="/privacy"
            element={
              <MarketingLayout>
                <Privacy />
              </MarketingLayout>
            }
          />
          <Route
            path="/terms"
            element={
              <MarketingLayout>
                <Terms />
              </MarketingLayout>
            }
          />
          <Route
            path="/contact"
            element={
              <MarketingLayout>
                <Contact />
              </MarketingLayout>
            }
          />

          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppShell>
                  <Feed />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/tenders/:matchId"
            element={
              <ProtectedRoute>
                <AppShell>
                  <TenderDetail />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/billing/success"
            element={
              <ProtectedRoute>
                <AppShell>
                  <BillingSuccess />
                </AppShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/settings"
            element={
              <ProtectedRoute>
                <AppShell>
                  <Settings />
                </AppShell>
              </ProtectedRoute>
            }
          />

          {/*
            Internal admin surface (Phase 10 stage B). `AdminGate` probes
            `/api/admin/health-details` on mount and renders the SAME
            `NotFound` page as the catch-all route below for any non-admin
            visitor — the admin surface's existence is never revealed
            client-side, mirroring the server's 404-for-everyone-but-admins
            cloaking (apps/worker/src/middleware/admin.ts).
          */}
          <Route path="/admin" element={<AdminGate />}>
            <Route index element={<AdminDashboard />} />
            <Route path="orgs" element={<AdminOrganizations />} />
            <Route path="orgs/:id" element={<AdminOrganizationDetail />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="subscriptions" element={<AdminSubscriptions />} />
            <Route path="ingestion" element={<AdminIngestion />} />
            <Route path="matching" element={<AdminMatching />} />
            <Route path="digest" element={<AdminDigest />} />
            <Route path="support" element={<AdminSupport />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="flags" element={<AdminFlags />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
