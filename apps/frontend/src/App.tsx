import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ProjectProvider } from './auth/project';
import { LANDING_ONLY, LandingOnlyContext } from './config';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell, Placeholder } from './layout/AppShell';
import { ComingSoon } from './layout/PublicLayout';
import { LandingPage } from './pages/landing/LandingPage';
import { ConnectionsPage } from './pages/connections/ConnectionsPage';
import { DeliveriesPage } from './pages/deliveries/DeliveriesPage';
import { DestinationsPage } from './pages/destinations/DestinationsPage';
import { EventsPage } from './pages/events/EventsPage';
import { LoginPage } from './pages/login/LoginPage';
import { InvitationAcceptPage } from './pages/org/InvitationAcceptPage';
import { MePage } from './pages/org/MePage';
import { OrgSettingsPage } from './pages/org/OrgSettingsPage';
import { PricingPage } from './pages/pricing/PricingPage';
import { ProjectSettingsPage } from './pages/settings/ProjectSettingsPage';
import { SourcesPage } from './pages/sources/SourcesPage';
import { UsagePage } from './pages/usage/UsagePage';

// 라우트 표. 화면이 늘 때마다 한 줄씩. 경로가 바뀌면 key가 바뀌어 .page의 페이드인이 다시 돈다
export function App({ landingOnly = LANDING_ONLY }: { landingOnly?: boolean }) {
	const { pathname } = useLocation();
	if (landingOnly)
		return (
			<LandingOnlyContext.Provider value={true}>
				<div key={pathname} className="page">
					<Routes>
						<Route path="/" element={<LandingPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</div>
			</LandingOnlyContext.Provider>
		);
	return (
		<div key={pathname} className="page">
			<Routes>
				<Route path="/" element={<LandingPage />} />
				<Route path="/pricing" element={<PricingPage />} />
				<Route path="/developers" element={<ComingSoon title="개발자" />} />
				<Route path="/docs" element={<ComingSoon title="문서" />} />
				<Route path="/login" element={<LoginPage />} />
				<Route element={<RequireAuth />}>
					<Route path="/invitations/:token" element={<InvitationAcceptPage />} />
					<Route
						path="/app"
						element={
							<ProjectProvider>
								<AppShell />
							</ProjectProvider>
						}
					>
						<Route index element={<Navigate to="/app/events" replace />} />
						<Route path="events" element={<EventsPage />} />
						<Route path="deliveries" element={<DeliveriesPage />} />
						<Route path="connections" element={<ConnectionsPage />} />
						<Route path="sources" element={<SourcesPage />} />
						<Route path="destinations" element={<DestinationsPage />} />
						<Route path="settings" element={<ProjectSettingsPage />} />
						<Route path="usage" element={<UsagePage />} />
						<Route path="org" element={<OrgSettingsPage />} />
						<Route path="me" element={<MePage />} />
						<Route path="*" element={<Placeholder />} />
					</Route>
				</Route>
			</Routes>
		</div>
	);
}
