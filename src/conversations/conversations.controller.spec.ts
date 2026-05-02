import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { GroupMemberService } from './group-member.service';
import { ConversationType } from './enums/conversation.enum';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: Record<string, jest.Mock>;
  let groupMemberService: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      createConversation: jest.fn(),
      getUserConversations: jest.fn(),
      isParticipant: jest.fn(),
      getReadReceipts: jest.fn(),
      getConversationType: jest.fn(),
      hideDirectConversation: jest.fn(),
      getMembers: jest.fn(),
      muteConversation: jest.fn(),
      unmuteConversation: jest.fn(),
    };
    groupMemberService = {
      updateGroupInfo: jest.fn(),
      addMembers: jest.fn(),
      kickMember: jest.fn(),
      leaveGroup: jest.fn(),
      updateMemberRole: jest.fn(),
      transferLeadership: jest.fn(),
      disbandGroup: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: service },
        { provide: GroupMemberService, useValue: groupMemberService },
      ],
    }).compile();
    controller = module.get<ConversationsController>(ConversationsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be decorated with JwtAuthGuard when class is evaluated', () => {
    const guards = Reflect.getMetadata('__guards__', ConversationsController);
    const hasJwtAuthGuard = guards.some(
      (guard: any) => guard.name === 'JwtAuthGuard',
    );
    expect(hasJwtAuthGuard).toBe(true);
  });

  it('should pass user.id and dto to service.createConversation when create() is called', async () => {
    const dto = { type: ConversationType.DIRECT, partnerId: 'u2' };
    service.createConversation.mockResolvedValue({ id: 'c1' });
    await controller.create({ id: 'u1' }, dto);
    expect(service.createConversation).toHaveBeenCalledWith('u1', dto);
  });

  it('should pass user.id, limit, cursor and query to service.getUserConversations when findAll() is called', async () => {
    service.getUserConversations.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasMore: false,
    });
    await controller.findAll({ id: 'u1' }, '20', 'cursor-123', 'test');
    expect(service.getUserConversations).toHaveBeenCalledWith(
      'u1',
      20,
      'cursor-123',
      'test',
    );
  });

  it('should return read receipts when getReadReceipts() is called', async () => {
    const receipts = [{ accountId: 'u1', lastReadMessageId: 'msg1' }];
    service.getReadReceipts.mockResolvedValue(receipts);

    const result = await controller.getReadReceipts({ id: 'u1' }, 'c1');

    expect(service.getReadReceipts).toHaveBeenCalledWith('u1', 'c1');
    expect(result).toEqual(receipts);
  });

  describe('deleteConversation()', () => {
    it('should call groupMemberService.disbandGroup when conversation is GROUP', async () => {
      service.getConversationType.mockResolvedValue('GROUP');
      groupMemberService.disbandGroup.mockResolvedValue({
        success: true,
        disbanded: true,
      });
      await controller.deleteConversation({ id: 'u1' }, 'c1');
      expect(groupMemberService.disbandGroup).toHaveBeenCalledWith('u1', 'c1');
    });

    it('should call service.hideDirectConversation when conversation is DIRECT', async () => {
      service.getConversationType.mockResolvedValue('DIRECT');
      service.hideDirectConversation.mockResolvedValue({
        success: true,
        hidden: true,
      });
      await controller.deleteConversation({ id: 'u1' }, 'c1');
      expect(service.hideDirectConversation).toHaveBeenCalledWith('u1', 'c1');
    });
  });

  it('should call groupMemberService.updateGroupInfo when updateGroupInfo() is called', async () => {
    const dto = { title: 'New Title' };
    groupMemberService.updateGroupInfo.mockResolvedValue({ id: 'c1' });
    await controller.updateGroupInfo({ id: 'u1' }, 'c1', dto);
    expect(groupMemberService.updateGroupInfo).toHaveBeenCalledWith(
      'u1',
      'c1',
      dto,
    );
  });

  it('should call groupMemberService.addMembers when addMembers() is called', async () => {
    const dto = { userIds: ['u2', 'u3'] };
    groupMemberService.addMembers.mockResolvedValue({ success: true });
    await controller.addMembers({ id: 'u1' }, 'c1', dto);
    expect(groupMemberService.addMembers).toHaveBeenCalledWith(
      'u1',
      'c1',
      dto.userIds,
    );
  });

  it('should call groupMemberService.kickMember when kickMember() is called', async () => {
    groupMemberService.kickMember.mockResolvedValue({ success: true });
    await controller.kickMember({ id: 'u1' }, 'c1', 'u2');
    expect(groupMemberService.kickMember).toHaveBeenCalledWith(
      'u1',
      'c1',
      'u2',
    );
  });

  it('should call groupMemberService.leaveGroup when leaveGroup() is called', async () => {
    groupMemberService.leaveGroup.mockResolvedValue({ success: true });
    await controller.leaveGroup({ id: 'u1' }, 'c1');
    expect(groupMemberService.leaveGroup).toHaveBeenCalledWith('u1', 'c1');
  });

  it('should call groupMemberService.updateMemberRole when updateMemberRole() is called', async () => {
    const dto = { role: 'DEPUTY' as any };
    groupMemberService.updateMemberRole.mockResolvedValue({ success: true });
    await controller.updateMemberRole({ id: 'u1' }, 'c1', 'u2', dto);
    expect(groupMemberService.updateMemberRole).toHaveBeenCalledWith(
      'u1',
      'c1',
      'u2',
      dto.role,
    );
  });

  it('should call groupMemberService.transferLeadership when transferLeadership() is called', async () => {
    const dto = { newLeaderId: 'u2' };
    groupMemberService.transferLeadership.mockResolvedValue({ success: true });
    await controller.transferLeadership({ id: 'u1' }, 'c1', dto);
    expect(groupMemberService.transferLeadership).toHaveBeenCalledWith(
      'u1',
      'c1',
      dto.newLeaderId,
    );
  });

  it('should call service.getMembers when getMembers() is called', async () => {
    service.getMembers.mockResolvedValue([]);
    await controller.getMembers({ id: 'u1' }, 'c1');
    expect(service.getMembers).toHaveBeenCalledWith('u1', 'c1');
  });

  it('should call service.muteConversation when muteConversation() is called', async () => {
    service.muteConversation.mockResolvedValue({ success: true });
    await controller.muteConversation({ id: 'u1' }, 'c1', {
      duration: '1h' as any,
    });
    expect(service.muteConversation).toHaveBeenCalledWith('u1', 'c1', '1h');
  });

  it('should call service.unmuteConversation when unmuteConversation() is called', async () => {
    service.unmuteConversation.mockResolvedValue({ success: true });
    await controller.unmuteConversation({ id: 'u1' }, 'c1');
    expect(service.unmuteConversation).toHaveBeenCalledWith('u1', 'c1');
  });
});
