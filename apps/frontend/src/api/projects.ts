import { api, type Page } from './client';

export type Org = { id: number; name: string; plan: 'free' | 'team' | 'business'; role: 'owner' | 'admin' | 'member' };
export type Project = { id: number; organization_id: number; name: string; suspended_at: string | null };

export const listOrgs = async () => (await api.get<Page<Org>>('/orgs', { params: { limit: 200 } })).data.data;
export const listProjects = async (orgId: number) => (await api.get<Page<Project>>(`/orgs/${orgId}/projects`, { params: { limit: 200 } })).data.data;
export const createProject = async (orgId: number, name: string) => (await api.post<Project>(`/orgs/${orgId}/projects`, { name })).data;
export const updateProject = async (orgId: number, id: number, name: string) => (await api.patch<Project>(`/orgs/${orgId}/projects/${id}`, { name })).data;
// 안의 소스·목적지·이벤트·전달 기록이 전부 같이 지워진다
export const deleteProject = async (orgId: number, id: number) => {
	await api.delete(`/orgs/${orgId}/projects/${id}`);
};
// 전달 서명 키. admin 이상만. 목적지가 X-Munjigi-Signature를 검증할 때 쓴다
export const getSigningSecret = async (orgId: number, id: number) => (await api.get<{ signing_secret: string }>(`/orgs/${orgId}/projects/${id}/signing-secret`)).data.signing_secret;
export const rotateSigningSecret = async (orgId: number, id: number) => (await api.post<{ signing_secret: string }>(`/orgs/${orgId}/projects/${id}/signing-secret/rotate`)).data.signing_secret;
