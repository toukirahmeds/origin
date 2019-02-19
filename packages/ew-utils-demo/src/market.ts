// Copyright 2018 Energy Web Foundation
// This file is part of the Origin Application brought to you by the Energy Web Foundation,
// a global non-profit organization focused on accelerating blockchain technology across the energy sector,
// incorporated in Zug, Switzerland.
//
// The Origin Application is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY and without an implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details, at <http://www.gnu.org/licenses/>.
//
// @authors: slock.it GmbH; Heiko Burkhardt, heiko.burkhardt@slock.it; Martin Kuechler, martin.kuchler@slock.it; Chirag Parmar, chirag.parmar@slock.it

import * as fs from 'fs';
import Web3 from 'web3';
import { certificateDemo } from './certificate'
import { deployEmptyContracts } from './deployEmpty'
import { logger } from './Logger';

import * as Certificate from 'ew-origin-lib';
import * as User from 'ew-user-registry-lib'
import * as Asset from 'ew-asset-registry-lib'
import * as GeneralLib from 'ew-utils-general-lib';
import * as Market from 'ew-market-lib';

import { UserContractLookup, UserLogic } from 'ew-user-registry-contracts';
import { AssetContractLookup, AssetProducingRegistryLogic, AssetConsumingRegistryLogic } from 'ew-asset-registry-contracts';
import { OriginContractLookup, CertificateLogic, migrateCertificateRegistryContracts } from 'ew-origin-contracts';
import { deployERC20TestToken, Erc20TestToken, TestReceiver, deployERC721TestReceiver } from 'ew-erc-test-contracts';
import { MarketContractLookup, MarketLogic } from 'ew-market-contracts';


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



export const marketDemo = async() => {

  const startTime = Date.now()

  await deployEmptyContracts()

  const connectionConfig = JSON.parse(fs.readFileSync(process.cwd() + '/connection-config.json', 'utf8').toString());
  const demoConfig = JSON.parse(fs.readFileSync(process.cwd() + '/config/demo-config.json', 'utf8').toString());
  const contractConfig = JSON.parse(fs.readFileSync(process.cwd() + '/config/contractConfig.json', 'utf8').toString());

  const web3 = new Web3(connectionConfig.develop.web3);

  const adminPK = demoConfig.topAdminPrivateKey.startsWith('0x') ?
      demoConfig.topAdminPrivateKey : '0x' + demoConfig.topAdminPrivateKey;

  const adminAccount = web3.eth.accounts.privateKeyToAccount(adminPK);

  //create logic instances
  const userLogic = new UserLogic(web3, contractConfig.userLogic)
  const assetProducingRegistryLogic = new AssetProducingRegistryLogic(web3, contractConfig.assetProducingRegistryLogic)
  const assetConsumingRegistryLogic = new AssetConsumingRegistryLogic(web3, contractConfig.assetConsumingRegistryLogic)
  const certificateLogic = new CertificateLogic(web3, contractConfig.certificateLogic)
  const marketLogic = new MarketLogic(web3, contractConfig.marketLogic)

  //set the admin account as an asset admin
  await userLogic.setUser(adminAccount.address, 'admin', { privateKey: adminPK });
  await userLogic.setRoles(adminAccount.address, 3, { privateKey: adminPK });

  //initialize a token to handle demo erc20 trading
  let erc20TestToken: Erc20TestToken

  //initialize variables for storing timeframe and currency
  let timeFrame
  let currency

  //blockchain configuration
  let conf: GeneralLib.Configuration.Entity;

  conf = {
      blockchainProperties: {
          activeUser: {
              address: adminAccount.address, privateKey: adminPK,
          },
          producingAssetLogicInstance: assetProducingRegistryLogic,
          consumingAssetLogicInstance: assetConsumingRegistryLogic,
          certificateLogicInstance: certificateLogic,
          userLogicInstance: userLogic,
          marketLogicInstance: marketLogic,
          web3,
      },
      offChainDataSource: {
          baseUrl: 'http://localhost:3030',
      },
      logger,
  };

  const actionsArray = demoConfig.flow

  for(const action of actionsArray) {
    switch(action.type) {
      case "CREATE_DEMAND":

        console.log("-----------------------------------------------------------")

        conf.blockchainProperties.activeUser = {
          address: action.data.trader, privateKey: action.data.traderPK,
        };

        const demandProps: Market.Demand.DemandOnChainProperties = {
          url: "",
          propertiesDocumentHash: "",
          demandOwner: action.data.trader,
        };

        try {
          const demand = await Market.Demand.createDemand(demandProps, conf);
          delete demand.proofs;
          delete demand.configuration;
          conf.logger.info("Demand Created, ID: " + demand.id)
        } catch(e) {
          conf.logger.error("Demand could not be created\n" + e)
        }

        console.log("-----------------------------------------------------------\n")

        break
      case "CREATE_SUPPLY":
        console.log("-----------------------------------------------------------")

        conf.blockchainProperties.activeUser = {
          address: action.data.assetOwner, privateKey: action.data.assetOwnerPK,
        };

        const supplyProps: Market.Supply.SupplyOnChainProperties = {
          url: "",
          propertiesDocumentHash: "",
          assetId: action.data.assetId,
        };


        try {
          const supply = await Market.Supply.createSupply(supplyProps, conf);
          delete supply.proofs;
          delete supply.configuration;
          conf.logger.info("Onboarded Supply ID: " + supply.id)
        } catch(e) {
          conf.logger.error("Could not onboard a supply\n" + e)
        }

        console.log("-----------------------------------------------------------\n")

        break

      case "MAKE_AGREEMENT":
        console.log("-----------------------------------------------------------")

        conf.blockchainProperties.activeUser = {
          address: action.data.creator,
          privateKey: action.data.creatorPK,
        };

        const agreementOffchainProps: Market.Agreement.AgreementOffChainProperties = {
          start: action.data.startTime,
          ende: action.data.endTime,
          price: action.data.price,
          currency: action.data.currency,
          period: action.data.period,
        };

        const matcherOffchainProps: Market.Agreement.MatcherOffchainProperties = {
          currentWh: action.data.currentWh,
          currentPeriod: action.data.currentPeriod,
        };

        const agreementProps: Market.Agreement.AgreementOnChainProperties = {
          propertiesDocumentHash: null,
          url: null,
          matcherDBURL: null,
          matcherPropertiesDocumentHash: null,
          demandId: action.data.demandId,
          supplyId: action.data.supplyId,
          allowedMatcher: [action.data.allowedMatcher],
        };

        try {
          const agreement = await Market.Agreement.createAgreement(agreementProps, agreementOffchainProps, matcherOffchainProps, conf);
          delete agreement.proofs;
          delete agreement.configuration;
          delete agreement.propertiesDocumentHash;
          delete agreement.matcherPropertiesDocumentHash;
          if(agreement.approvedBySupplyOwner && agreement.approvedByDemandOwner){
            conf.logger.info("Agreement Confirmed")
          }
          else if(!agreement.approvedByDemandOwner) {
            conf.logger.info("Demand Owner did not approve yet")
          }
          else if(!agreement.approvedBySupplyOwner) {
            conf.logger.info("Supply Owner did not approve yet")
          }
        } catch(e) {
          conf.logger.error("Error making an agreement\n" + e)
        }

        console.log("-----------------------------------------------------------\n")
        break
      case "APPROVE_AGREEMENT":
        console.log("-----------------------------------------------------------")

        conf.blockchainProperties.activeUser = {
          address: action.data.agree,
          privateKey: action.data.agreePK,
        };

        try {
          let agreement: Market.Agreement.Entity = await (new Market.Agreement.Entity(action.data.agreementId.toString(), conf)).sync();
          await agreement.approveAgreementSupply();
          agreement = await agreement.sync();
          if(agreement.approvedBySupplyOwner && agreement.approvedByDemandOwner){
            conf.logger.info("Agreement Confirmed")
          }
          else if(!agreement.approvedByDemandOwner) {
            conf.logger.info("Demand Owner did not approve yet")
          }
          else if(!agreement.approvedBySupplyOwner) {
            conf.logger.info("Supply Owner did not approve yet")
          }
        } catch(e) {
          conf.logger.error("Could not approve agreement\n" + e)
        }

        console.log("-----------------------------------------------------------\n")
        break
      default:
        const passString = JSON.stringify(action)
        await certificateDemo(passString, conf, adminPK)
    }
  }
  conf.logger.info("Total Time: " + ((Date.now()-startTime)/1000) + " seconds")
}

marketDemo()