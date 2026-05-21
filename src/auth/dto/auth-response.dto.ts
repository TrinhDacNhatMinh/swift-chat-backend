export class AuthUserDto {
  id: string;
  email: string;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
}
