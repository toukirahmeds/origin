import { assert } from 'chai';
import dotenv from 'dotenv';
import Web3 from 'web3';
import 'mocha';
import moment from 'moment';

import { Configuration } from '@energyweb/utils-general';
import { OffChainDataSourceMock } from '@energyweb/origin-backend-client-mocks';

import { migratePublicIssuer, migrateRegistry } from '../migrate';
import { RequestIssue, PublicIssuer, Registry } from '..';

import { logger } from '../Logger';

describe('PublicIssuer', () => {
    let publicIssuer: PublicIssuer;
    let registry: Registry;
    let conf: Configuration.Entity;

    dotenv.config({
        path: '.env.test'
    });

    const web3 = new Web3(process.env.WEB3);
    const deployKey = process.env.DEPLOY_KEY;

    const privateKeyDeployment = deployKey.startsWith('0x') ? deployKey : `0x${deployKey}`;
    const accountDeployment = web3.eth.accounts.privateKeyToAccount(privateKeyDeployment).address;

    const deviceOwnerPK = '0xd9bc30dc17023fbb68fe3002e0ff9107b241544fd6d60863081c55e383f1b5a3';
    const accountDeviceOwner = web3.eth.accounts.privateKeyToAccount(deviceOwnerPK).address;

    const issuerPK = '0x50397ee7580b44c966c3975f561efb7b58a54febedaa68a5dc482e52fb696ae7';
    const issuerAccount = web3.eth.accounts.privateKeyToAccount(issuerPK).address;

    let timestamp = moment().subtract(10, 'year').unix();

    const setActiveUser = (privateKey: string) => {
        conf.blockchainProperties.activeUser = {
            address: web3.eth.accounts.privateKeyToAccount(privateKey).address,
            privateKey
        };
    };

    it('migrates PublicIssuer and Registry', async () => {
        registry = await migrateRegistry(web3, privateKeyDeployment);
        publicIssuer = await migratePublicIssuer(
            web3,
            privateKeyDeployment,
            registry.web3Contract.options.address
        );
        const version = await publicIssuer.version();
        assert.equal(version, 'v0.1');

        const registryAddress = await publicIssuer.getRegistryAddress();
        assert.equal(registryAddress, registry.web3Contract.options.address);

        conf = {
            blockchainProperties: {
                activeUser: {
                    address: accountDeployment,
                    privateKey: privateKeyDeployment
                },
                issuerLogicInstance: { public: publicIssuer, private: publicIssuer },
                web3
            },
            offChainDataSource: new OffChainDataSourceMock(),
            logger
        };
    });

    it('user correctly requests issuance', async () => {
        setActiveUser(deviceOwnerPK);
        
        const fromTime = timestamp;
        // Simulate time moving forward 1 month
        timestamp += 30 * 24 * 3600;
        const toTime = timestamp;
        const deviceId = '1';

        const requestIssue = await RequestIssue.createRequestIssue(
            fromTime,
            toTime,
            deviceId,
            conf
        );

        assert.isAbove(Number(requestIssue.id), -1);

        assert.deepOwnInclude(requestIssue, {
            initialized: true,
            deviceId,
            owner: accountDeviceOwner,
            fromTime,
            toTime,
            approved: false,
            isPrivate: false
        } as Partial<RequestIssue.Entity>);
    });

    it('issuer correctly approves issuance', async () => {
        setActiveUser(deviceOwnerPK);

        const fromTime = timestamp;
        // Simulate time moving forward 1 month
        timestamp += 30 * 24 * 3600;
        const toTime = timestamp;
        const deviceId = '1';

        let requestIssue = await RequestIssue.createRequestIssue(
            fromTime,
            toTime,
            deviceId,
            conf
        );

        setActiveUser(issuerPK);

        const volume = 1000;
        const certificateId = await requestIssue.approve(accountDeviceOwner, volume);

        requestIssue = await requestIssue.sync();

        assert.isTrue(requestIssue.approved);

        const deviceOwnerBalance = await registry.balanceOf(
            accountDeviceOwner,
            Number(certificateId)
        );
        assert.equal(deviceOwnerBalance, volume);
    });

    it('issuer revokes a certificate', async () => {
        setActiveUser(deviceOwnerPK);

        const fromTime = timestamp;
        // Simulate time moving forward 1 month
        timestamp += 30 * 24 * 3600;
        const toTime = timestamp;
        const deviceId = '1';

        let requestIssue = await RequestIssue.createRequestIssue(fromTime, toTime, deviceId, conf);

        setActiveUser(issuerPK);

        const volume = 1000;
        const certificateId = await requestIssue.approve(accountDeviceOwner, volume);

        requestIssue = await requestIssue.sync();

        assert.isTrue(requestIssue.approved);
        assert.isFalse(requestIssue.revoked);

        await requestIssue.revoke();

        requestIssue = await requestIssue.sync();
        assert.isTrue(requestIssue.revoked);

        const deviceOwnerBalance = await registry.balanceOf(
            accountDeviceOwner,
            Number(certificateId)
        );
        assert.equal(deviceOwnerBalance, volume);
    });

    it('should fail to request 2 certificates with the same generation period', async () => {
        setActiveUser(deviceOwnerPK);

        const fromTime = timestamp;
        // Simulate time moving forward 1 month
        timestamp += 30 * 24 * 3600;
        const toTime = timestamp;
        const deviceId = '1';

        await RequestIssue.createRequestIssue(fromTime, toTime, deviceId, conf);

        let failed = false;

        try {
            await RequestIssue.createRequestIssue(fromTime, toTime, deviceId, conf);
        } catch (e) {
            failed = true;
        }

        assert.isTrue(failed);
    });

    it('should request the same certificate after revoking one', async () => {
        setActiveUser(deviceOwnerPK);

        const fromTime = timestamp;
        // Simulate time moving forward 1 month
        timestamp += 30 * 24 * 3600;
        const toTime = timestamp;
        const deviceId = '1';

        let requestIssue = await RequestIssue.createRequestIssue(fromTime, toTime, deviceId, conf);

        setActiveUser(issuerPK);

        const volume = 1000;
        await requestIssue.approve(accountDeviceOwner, volume);
        requestIssue = await requestIssue.sync();

        await requestIssue.revoke();
        requestIssue = await requestIssue.sync();

        const newRequestIssue = await RequestIssue.createRequestIssue(fromTime, toTime, deviceId, conf);

        assert.exists(newRequestIssue);
    });
});