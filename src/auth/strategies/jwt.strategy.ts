import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UserService } from '../../user/user.service';
import { CONFIG_KEYS } from '../../common/constants/config.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>(
        CONFIG_KEYS.JWT_ACCESS_SECRET,
      ),
    });
  }

  async validate(payload: JwtPayload) {
    // Validate that the account actually still exists in our DB
    const account = await this.userService.findById(payload.sub);
    if (!account) {
      throw new UnauthorizedException();
    }

    // We return the account object (or parts of it) which will be bound to req.account
    return { id: payload.sub, email: payload.email };
  }
}
