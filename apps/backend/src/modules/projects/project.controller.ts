import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '@/common/auth/decorators';
import { ListQueryDto } from '@/common/http/pagination';
import { OrgIdParamDto } from '@/common/http/params';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import { ProjectDto, ProjectPageDto, ProjectParamDto, SigningSecretDto } from './dto/get-project.dto';
import { ProjectService } from './project.service';

@ApiTags('projects')
@Controller('orgs/:orgId/projects')
export class ProjectController {
	constructor(private readonly projects: ProjectService) {}

	@Roles('member')
	@Get()
	@ApiOperation({ summary: '조직의 프로젝트 목록을 조회한다' })
	@ApiResponse({ status: 200, type: ProjectPageDto })
	list(@Param() { orgId }: OrgIdParamDto, @Query() query: ListQueryDto): Promise<ProjectPageDto> {
		return this.projects.list(orgId, query);
	}

	@Roles('admin')
	@Post()
	@ApiOperation({ summary: '프로젝트를 만든다. 플랜별 개수 상한(free 1, 유료 무제한). 전달 서명 키를 같이 만든다' })
	@ApiResponse({ status: 201, type: ProjectDto })
	@ApiResponse({ status: 400, description: 'validation_failed' })
	@ApiResponse({ status: 403, description: 'forbidden — admin 미만 / plan_limit — 개수 상한' })
	create(@Param() { orgId }: OrgIdParamDto, @Body() body: CreateProjectDto): Promise<ProjectDto> {
		return this.projects.create(orgId, body);
	}

	@Roles('member')
	@Get(':projectId')
	@ApiOperation({ summary: '프로젝트를 조회한다' })
	@ApiResponse({ status: 200, type: ProjectDto })
	@ApiResponse({ status: 404, description: 'project_not_found — 없거나 타 조직' })
	get(@Param() { orgId, projectId }: ProjectParamDto): Promise<ProjectDto> {
		return this.projects.get(orgId, projectId);
	}

	@Roles('admin')
	@Patch(':projectId')
	@ApiOperation({ summary: '프로젝트 이름을 바꾼다' })
	@ApiResponse({ status: 200, type: ProjectDto })
	@ApiResponse({ status: 403, description: 'forbidden — admin 미만' })
	@ApiResponse({ status: 404, description: 'project_not_found' })
	update(@Param() { orgId, projectId }: ProjectParamDto, @Body() body: UpdateProjectDto): Promise<ProjectDto> {
		return this.projects.update(orgId, projectId, body);
	}

	@Roles('admin')
	@Delete(':projectId')
	@HttpCode(204)
	@ApiOperation({ summary: '프로젝트를 삭제한다. 안의 소스·목적지·이벤트·전달 기록이 전부 같이 지워진다' })
	@ApiResponse({ status: 204 })
	@ApiResponse({ status: 403, description: 'forbidden — admin 미만' })
	@ApiResponse({ status: 404, description: 'project_not_found' })
	remove(@Param() { orgId, projectId }: ProjectParamDto): Promise<void> {
		return this.projects.remove(orgId, projectId);
	}

	@Roles('admin')
	@Get(':projectId/signing-secret')
	@ApiOperation({ summary: '전달 서명 키를 조회한다. 전달 요청의 X-Hookbuffer-Signature는 이 키로 계산한 본문의 HMAC-SHA256(base64)다' })
	@ApiResponse({ status: 200, type: SigningSecretDto })
	@ApiResponse({ status: 403, description: 'forbidden — admin 미만' })
	@ApiResponse({ status: 404, description: 'project_not_found' })
	getSigningSecret(@Param() { orgId, projectId }: ProjectParamDto): Promise<SigningSecretDto> {
		return this.projects.getSigningSecret(orgId, projectId);
	}

	@Roles('admin')
	@Post(':projectId/signing-secret/rotate')
	@HttpCode(200)
	@ApiOperation({ summary: '전달 서명 키를 새로 만든다. 그 뒤 전달부터 새 키로 서명한다' })
	@ApiResponse({ status: 200, type: SigningSecretDto })
	@ApiResponse({ status: 403, description: 'forbidden — admin 미만' })
	@ApiResponse({ status: 404, description: 'project_not_found' })
	rotateSigningSecret(@Param() { orgId, projectId }: ProjectParamDto): Promise<SigningSecretDto> {
		return this.projects.rotateSigningSecret(orgId, projectId);
	}
}
