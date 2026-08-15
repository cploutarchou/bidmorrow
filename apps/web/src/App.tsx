import type { ReactElement } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { MarketingLayout } from './components/MarketingLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
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
import { Feed } from './pages/app/Feed';
import { Onboarding } from './pages/app/Onboarding';
import { Settings } from './pages/app/Settings';
import { TenderDetail } from './pages/app/TenderDetail';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <MarketingLayout>
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
            path="/app/settings"
            element={
              <ProtectedRoute>
                <AppShell>
                  <Settings />
                </AppShell>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
