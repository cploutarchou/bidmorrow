import type { ReactElement } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { AppShell } from './components/AppShell';
import { MarketingLayout } from './components/MarketingLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouteChunkBoundary } from './components/RouteChunkBoundary';
import { AuthProvider } from './lib/auth-context';
import { Lazy, lazyPage } from './lib/lazy-page';
import { Home } from './pages/marketing/Home';
import { NotFound } from './pages/NotFound';

/*
 * Route-level code splitting. Before this, one 478 kB chunk shipped the entire
 * admin surface, the onboarding wizard and Settings to every marketing
 * visitor, against a documented 150 kB budget for the marketing entry.
 *
 * `Home` and `NotFound` stay eagerly imported: Home is the LCP route, so
 * splitting it would add a round trip to first paint, and NotFound is tiny and
 * doubles as the admin cloak (it must render without fetching anything).
 */
const HowItWorks = lazyPage(() => import('./pages/marketing/HowItWorks'), 'HowItWorks');
const CybersecurityTenders = lazyPage(
  () => import('./pages/marketing/CybersecurityTenders'),
  'CybersecurityTenders',
);
const SampleVerdicts = lazyPage(() => import('./pages/marketing/SampleVerdicts'), 'SampleVerdicts');
const Methodology = lazyPage(() => import('./pages/marketing/Methodology'), 'Methodology');
const Pricing = lazyPage(() => import('./pages/marketing/Pricing'), 'Pricing');
const Pilot = lazyPage(() => import('./pages/marketing/Pilot'), 'Pilot');
const Privacy = lazyPage(() => import('./pages/marketing/Privacy'), 'Privacy');
const Terms = lazyPage(() => import('./pages/marketing/Terms'), 'Terms');
const Contact = lazyPage(() => import('./pages/marketing/Contact'), 'Contact');

const Login = lazyPage(() => import('./pages/auth/Login'), 'Login');
const Signup = lazyPage(() => import('./pages/auth/Signup'), 'Signup');
const VerifyEmail = lazyPage(() => import('./pages/auth/VerifyEmail'), 'VerifyEmail');
const ForgotPassword = lazyPage(() => import('./pages/auth/ForgotPassword'), 'ForgotPassword');
const ResetPassword = lazyPage(() => import('./pages/auth/ResetPassword'), 'ResetPassword');

const Feed = lazyPage(() => import('./pages/app/Feed'), 'Feed');
const TenderDetail = lazyPage(() => import('./pages/app/TenderDetail'), 'TenderDetail');
const TenderSheet = lazyPage(() => import('./pages/app/TenderSheet'), 'TenderSheet');
const Settings = lazyPage(() => import('./pages/app/Settings'), 'Settings');
const Onboarding = lazyPage(() => import('./pages/app/Onboarding'), 'Onboarding');
const BillingSuccess = lazyPage(() => import('./pages/app/BillingSuccess'), 'BillingSuccess');

/* The admin surface — gate, shell, 11 pages and their lib/admin-* modules —
   leaves the customer bundle entirely. Nothing outside pages/admin and
   components/admin imports it, so the seam is clean. */
const AdminGate = lazyPage(() => import('./components/admin/AdminGate'), 'AdminGate');
const AdminDashboard = lazyPage(() => import('./pages/admin/Dashboard'), 'Dashboard');
const AdminOrganizations = lazyPage(() => import('./pages/admin/Organizations'), 'Organizations');
const AdminOrganizationDetail = lazyPage(
  () => import('./pages/admin/OrganizationDetail'),
  'OrganizationDetail',
);
const AdminUsers = lazyPage(() => import('./pages/admin/Users'), 'Users');
const AdminSubscriptions = lazyPage(() => import('./pages/admin/Subscriptions'), 'Subscriptions');
const AdminIngestion = lazyPage(() => import('./pages/admin/Ingestion'), 'Ingestion');
const AdminMatching = lazyPage(() => import('./pages/admin/Matching'), 'Matching');
const AdminDigest = lazyPage(() => import('./pages/admin/Digest'), 'Digest');
const AdminSupport = lazyPage(() => import('./pages/admin/Support'), 'Support');
const AdminAudit = lazyPage(() => import('./pages/admin/Audit'), 'Audit');
const AdminFlags = lazyPage(() => import('./pages/admin/Flags'), 'Flags');

/**
 * A tender opened FROM the feed shows as a slide-over over the feed; the same
 * URL visited directly shows the full page.
 *
 * The mechanism is the location's `backgroundLocation` state, set by the feed
 * card's link. When it is present, the main `<Routes>` is rendered against
 * that background — so the feed stays mounted and keeps its scroll, loaded
 * pages and filters — and a second `<Routes>` renders the sheet on top.
 * Without it (shared link, bookmark, refresh, or a hard reload of the sheet
 * URL) there is no feed to render behind, so the full page is the right
 * answer and is what appears.
 *
 * The tender therefore keeps one real, linkable URL either way, which a
 * state-only sheet would have thrown away.
 */
interface BackgroundLocationState {
  readonly backgroundLocation?: { readonly pathname: string; readonly search: string };
}

function AppRoutes(): ReactElement {
  const location = useLocation();
  const state = location.state as BackgroundLocationState | null;
  const background = state?.backgroundLocation;

  return (
    <>
      <Routes location={background ?? location}>
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
              <Lazy>
                <Pricing />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/how-it-works"
          element={
            <MarketingLayout>
              <Lazy>
                <HowItWorks />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/sample-verdicts"
          element={
            <MarketingLayout>
              <Lazy>
                <SampleVerdicts />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/cybersecurity-tenders"
          element={
            <MarketingLayout>
              <Lazy>
                <CybersecurityTenders />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/methodology"
          element={
            <MarketingLayout>
              <Lazy>
                <Methodology />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/pilot"
          element={
            <MarketingLayout>
              <Lazy>
                <Pilot />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/privacy"
          element={
            <MarketingLayout>
              <Lazy>
                <Privacy />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/terms"
          element={
            <MarketingLayout>
              <Lazy>
                <Terms />
              </Lazy>
            </MarketingLayout>
          }
        />
        <Route
          path="/contact"
          element={
            <MarketingLayout>
              <Lazy>
                <Contact />
              </Lazy>
            </MarketingLayout>
          }
        />

        <Route
          path="/signup"
          element={
            <Lazy>
              <Signup />
            </Lazy>
          }
        />
        <Route
          path="/login"
          element={
            <Lazy>
              <Login />
            </Lazy>
          }
        />
        <Route
          path="/verify-email"
          element={
            <Lazy>
              <VerifyEmail />
            </Lazy>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <Lazy>
              <ForgotPassword />
            </Lazy>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Lazy>
              <ResetPassword />
            </Lazy>
          }
        />

        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <Lazy>
                <Onboarding />
              </Lazy>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppShell>
                <Lazy>
                  <Feed />
                </Lazy>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/tenders/:matchId"
          element={
            <ProtectedRoute>
              <AppShell>
                <Lazy>
                  <TenderDetail />
                </Lazy>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/billing/success"
          element={
            <ProtectedRoute>
              <AppShell>
                <Lazy>
                  <BillingSuccess />
                </Lazy>
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/settings"
          element={
            <ProtectedRoute>
              <AppShell>
                <Lazy>
                  <Settings />
                </Lazy>
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
        <Route
          path="/admin"
          element={
            <Lazy>
              <AdminGate />
            </Lazy>
          }
        >
          <Route
            index
            element={
              <Lazy>
                <AdminDashboard />
              </Lazy>
            }
          />
          <Route
            path="orgs"
            element={
              <Lazy>
                <AdminOrganizations />
              </Lazy>
            }
          />
          <Route
            path="orgs/:id"
            element={
              <Lazy>
                <AdminOrganizationDetail />
              </Lazy>
            }
          />
          <Route
            path="users"
            element={
              <Lazy>
                <AdminUsers />
              </Lazy>
            }
          />
          <Route
            path="subscriptions"
            element={
              <Lazy>
                <AdminSubscriptions />
              </Lazy>
            }
          />
          <Route
            path="ingestion"
            element={
              <Lazy>
                <AdminIngestion />
              </Lazy>
            }
          />
          <Route
            path="matching"
            element={
              <Lazy>
                <AdminMatching />
              </Lazy>
            }
          />
          <Route
            path="digest"
            element={
              <Lazy>
                <AdminDigest />
              </Lazy>
            }
          />
          <Route
            path="support"
            element={
              <Lazy>
                <AdminSupport />
              </Lazy>
            }
          />
          <Route
            path="audit"
            element={
              <Lazy>
                <AdminAudit />
              </Lazy>
            }
          />
          <Route
            path="flags"
            element={
              <Lazy>
                <AdminFlags />
              </Lazy>
            }
          />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      {background !== undefined && (
        <Routes>
          <Route
            path="/app/tenders/:matchId"
            element={
              <ProtectedRoute>
                <Lazy>
                  <TenderSheet />
                </Lazy>
              </ProtectedRoute>
            }
          />
        </Routes>
      )}
    </>
  );
}

export function App(): ReactElement {
  return (
    <AuthProvider>
      <RouteChunkBoundary>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </RouteChunkBoundary>
    </AuthProvider>
  );
}
