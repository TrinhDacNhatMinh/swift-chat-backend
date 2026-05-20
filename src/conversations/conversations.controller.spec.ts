import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationType } from './enums/conversation.enum';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      createConversation: jest.fn(),
      getUserConversations: jest.fn(),
      isParticipant: jest.fn(),
      getReadReceipts: jest.fn(),
      deleteConversation: jest.fn(),
      updateGroupInfo: jest.fn(),
      addMembers: jest.fn(),
      kickMember: jest.fn(),
      leaveGroup: jest.fn(),
      updateMemberRole: jest.fn(),
      transferLeadership: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: service }],
    }).compile();
    controller = module.get<ConversationsController>(ConversationsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be decorated with JwtAuthGuard when class is evaluated', () => {
    const guards = Reflect.getMetadata('__guards__', ConversationsController);
    const hasJwtAuthGuard = guards.some((guard: any) => guard.name === 'JwtAuthGuard');
    expect(hasJwtAuthGuard).toBe(true);
  });

  it('should pass user.id and dto to service.createConversation when create() is called', async () => {
    const dto = { type: ConversationType.DIRECT, partnerId: 'u2' };
    service.createConversation.mockResolvedValue({ id: 'c1' });
    await controller.create({ id: 'u1' }, dto);
    expect(service.createConversation).toHaveBeenCalledWith('u1', dto);
  });

  it('should pass user.id, limit, and offset to service.getUserConversations when findAll() is called', async () => {
    service.getUserConversations.mockResolvedValue({ data: [], total: 0 });
    await controller.findAll({ id: 'u1' }, { limit: 20, offset: 0 });
    expect(service.getUserConversations).toHaveBeenCalledWith('u1', 20, 0);
  });

  it('should throw ForbiddenException when user is not a participant in getReadReceipts()', async () => {
    service.isParticipant.mockResolvedValue(false);
    await expect(
      controller.getReadReceipts({ id: 'u1' }, 'c1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should return read receipts when user is a participant in getReadReceipts()', async () => {
    service.isParticipant.mockResolvedValue(true);
    const receipts = [{ userId: 'u1', lastReadMessageId: 'msg1' }];
    service.getReadReceipts.mockResolvedValue(receipts);

    const result = await controller.getReadReceipts({ id: 'u1' }, 'c1');

    expect(service.isParticipant).toHaveBeenCalledWith('u1', 'c1');
    expect(result).toEqual(receipts);
  });

  it('should call service.deleteConversation when deleteConversation() is called', async () => {
    service.deleteConversation.mockResolvedValue({ success: true });
    await controller.deleteConversation({ id: 'u1' }, 'c1');
    expect(service.deleteConversation).toHaveBeenCalledWith('u1', 'c1');
  });

  it('should call service.updateGroupInfo when updateGroupInfo() is called', async () => {
    const dto = { title: 'New Title' };
    service.updateGroupInfo.mockResolvedValue({ id: 'c1' });
    await controller.updateGroupInfo({ id: 'u1' }, 'c1', dto);
    expect(service.updateGroupInfo).toHaveBeenCalledWith('u1', 'c1', dto);
  });

  it('should call service.addMembers when addMembers() is called', async () => {
    const dto = { userIds: ['u2', 'u3'] };
    service.addMembers.mockResolvedValue({ success: true });
    await controller.addMembers({ id: 'u1' }, 'c1', dto);
    expect(service.addMembers).toHaveBeenCalledWith('u1', 'c1', dto.userIds);
  });

  it('should call service.kickMember when kickMember() is called', async () => {
    service.kickMember.mockResolvedValue({ success: true });
    await controller.kickMember({ id: 'u1' }, 'c1', 'u2');
    expect(service.kickMember).toHaveBeenCalledWith('u1', 'c1', 'u2');
  });

  it('should call service.leaveGroup when leaveGroup() is called', async () => {
    service.leaveGroup.mockResolvedValue({ success: true });
    await controller.leaveGroup({ id: 'u1' }, 'c1');
    expect(service.leaveGroup).toHaveBeenCalledWith('u1', 'c1');
  });

  it('should call service.updateMemberRole when updateMemberRole() is called', async () => {
    const dto = { role: 'DEPUTY' as any };
    service.updateMemberRole.mockResolvedValue({ success: true });
    await controller.updateMemberRole({ id: 'u1' }, 'c1', 'u2', dto);
    expect(service.updateMemberRole).toHaveBeenCalledWith('u1', 'c1', 'u2', dto.role);
  });

  it('should call service.transferLeadership when transferLeadership() is called', async () => {
    const dto = { newLeaderId: 'u2' };
    service.transferLeadership.mockResolvedValue({ success: true });
    await controller.transferLeadership({ id: 'u1' }, 'c1', dto);
    expect(service.transferLeadership).toHaveBeenCalledWith('u1', 'c1', dto.newLeaderId);
  });
});
