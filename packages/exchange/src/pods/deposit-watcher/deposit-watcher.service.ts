import { Contracts } from '@energyweb/issuer';
import { getProviderWithFallback } from '@energyweb/utils-general';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Contract, ethers, providers } from 'ethers';
import moment from 'moment';

import { IExchangeConfigurationService, IExternalDeviceService } from '../../interfaces';
import { AccountService } from '../account/account.service';
import { CreateAskDTO } from '../order/create-ask.dto';
import { OrderService } from '../order/order.service';
import { TransferStatus } from '../transfer/transfer-status';
import { TransferService } from '../transfer/transfer.service';

@Injectable()
export class DepositWatcherService implements OnModuleInit {
    private readonly logger = new Logger(DepositWatcherService.name);

    private tokenInterface = new ethers.utils.Interface(Contracts.RegistryJSON.abi);

    private walletAddress: string;

    private registryAddress: string;

    private provider: providers.FallbackProvider;

    private issuer: Contract;

    private registry: Contract;

    private issuerTypeId: string;

    private deviceService: IExternalDeviceService;

    public constructor(
        private readonly configService: ConfigService,
        private readonly transferService: TransferService,
        private readonly orderService: OrderService,
        private readonly accountService: AccountService,
        private readonly moduleRef: ModuleRef
    ) {
        this.issuerTypeId = this.configService.get<string>('ISSUER_ID');
    }

    public async onModuleInit() {
        this.logger.debug('onModuleInit');

        this.deviceService = this.moduleRef.get<IExternalDeviceService>(IExternalDeviceService, {
            strict: false
        });

        const exchangeConfigService = this.moduleRef.get<IExchangeConfigurationService>(
            IExchangeConfigurationService,
            {
                strict: false
            }
        );

        this.walletAddress = this.configService.get<string>('EXCHANGE_WALLET_PUB');

        const issuer = await exchangeConfigService.getIssuerAddress();
        this.registryAddress = await exchangeConfigService.getRegistryAddress();

        const web3ProviderUrl = this.configService.get<string>('WEB3');
        this.provider = getProviderWithFallback(...web3ProviderUrl.split(';'));

        this.registry = new Contract(
            this.registryAddress,
            Contracts.RegistryJSON.abi,
            this.provider
        );

        this.issuer = new Contract(issuer, Contracts.IssuerJSON.abi, this.provider);

        const topics = [
            this.tokenInterface.getEventTopic(this.tokenInterface.getEvent('TransferSingle'))
        ];
        const blockNumber = await this.transferService.getLastConfirmationBlock();

        this.logger.debug(`Starting from block ${blockNumber}`);

        this.provider.resetEventsBlock(blockNumber);
        this.provider.on(
            {
                address: this.registryAddress,
                topics
            },
            (event: providers.Log) => this.processEvent(event)
        );
    }

    private async processEvent(event: providers.Log) {
        this.logger.debug(`Discovered new event ${JSON.stringify(event)}`);

        const { name } = this.tokenInterface.parseLog(event);
        const log = this.tokenInterface.decodeEventLog(name, event.data, event.topics);

        this.logger.debug(`Parsed to ${JSON.stringify(log)}`);

        const { _from: from, _to: to, _value: value, _id: id } = log;

        if (to !== this.walletAddress) {
            this.logger.debug(
                `This transfer is to other address ${to} than wallet address ${this.walletAddress}`
            );
            return;
        }

        const { transactionHash } = event;

        try {
            let transfer = await this.transferService.findOne(null, {
                where: { transactionHash }
            });

            if (transfer) {
                this.logger.debug(
                    `Deposit with transactionHash ${transactionHash} already exists and has status ${
                        TransferStatus[transfer.status]
                    } `
                );

                return;
            }

            const { generationFrom, generationTo, deviceId } = await this.decodeDataField(
                id.toString()
            );

            const amount = value.toString();

            transfer = await this.transferService.createDeposit({
                transactionHash,
                address: from as string,
                amount,
                asset: {
                    address: this.registryAddress,
                    tokenId: id.toString(),
                    deviceId,
                    generationFrom,
                    generationTo
                }
            });

            const receipt = await this.provider.waitForTransaction(transactionHash);

            await this.transferService.setAsConfirmed(transactionHash, receipt.blockNumber);

            this.logger.debug(
                `Successfully created deposit of tokenId=${id} from=${from} with value=${value} for user=${transfer.userId} `
            );

            await this.tryPostForSale(deviceId, from, amount, transfer.asset.id);
        } catch (error) {
            this.logger.error(error.message);
        }
    }

    private async decodeDataField(certificateId: string) {
        const { data } = await this.registry.getCertificate(certificateId);

        const result = await this.issuer.decodeData(data);

        return {
            generationFrom: moment.unix(result[0]).toDate(),
            generationTo: moment.unix(result[1]).toDate(),
            deviceId: result[2]
        };
    }

    private async tryPostForSale(
        deviceId: string,
        sender: string,
        amount: string,
        assetId: string
    ) {
        this.logger.debug(
            `Trying to post for sale deviceId=${deviceId} sender=${sender} amount=${amount} assetId=${assetId}`
        );

        const { postForSale, postForSalePrice } = await this.deviceService.getDeviceSettings({
            id: deviceId,
            type: this.issuerTypeId
        });
        const { userId } = await this.accountService.findByAddress(sender);

        if (!postForSale) {
            this.logger.debug(`Device ${deviceId} does not have automaticPostForSale enabled`);
            return;
        }

        const ask: CreateAskDTO = {
            price: postForSalePrice,
            validFrom: new Date(),
            volume: amount,
            assetId
        };
        await this.orderService.createAsk(userId, ask);
    }
}
