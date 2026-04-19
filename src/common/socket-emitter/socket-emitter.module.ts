import { Module, Global } from '@nestjs/common';
import { SocketEmitterService } from './socket-emitter.service';

@Global()
@Module({
  providers: [SocketEmitterService],
  exports: [SocketEmitterService],
})
export class SocketEmitterModule {}
