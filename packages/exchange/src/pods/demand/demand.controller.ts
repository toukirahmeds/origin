import { IUser } from '@energyweb/origin-backend-core';
import { Controller, Get, Logger, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { UserDecorator } from '../decorators/user.decorator';
import { DemandService } from './demand.service';

@Controller('demand')
export class DemandController {
    private readonly logger = new Logger(DemandController.name);

    constructor(private readonly demandService: DemandService) {}

    @Get('/:id')
    @UseGuards(AuthGuard())
    public async findOne(
        @UserDecorator() user: IUser,
        @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
    ) {
        this.logger.debug(`Requesting demand ${id} from user ${user.id}`);
        const demand = await this.demandService.findOne(user.id.toString(), id);

        if (!demand) {
            return null;
        }

        return demand;
    }

    @Get()
    @UseGuards(AuthGuard())
    public async getAll(@UserDecorator() user: IUser) {
        return this.demandService.getAll(user.id.toString());
    }
}
