import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
	@ApiProperty({ description: 'Google Identity Services가 발급한 ID 토큰(JWT)', example: 'eyJhbGciOiJSUzI1NiIs...' })
	@IsString()
	@IsNotEmpty()
	id_token: string;
}

export class AccessTokenDto {
	@ApiProperty({ description: 'hookbuffer access JWT. 만료 7일. Authorization: Bearer로 보낸다', example: 'eyJhbGciOiJIUzI1NiIs...' })
	access_token: string;
}
