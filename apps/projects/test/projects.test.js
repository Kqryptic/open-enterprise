truffleAssert = require('truffle-assertions')

/* global artifact, ... */
const {
  ACL,
  DAOFactory,
  EVMScriptRegistryFactory,
  Kernel,
  MiniMeToken,
  BountiesEvents,
} = require('@tps/test-helpers/artifacts')

const Vault = artifacts.require('Vault')
const Projects = artifacts.require('Projects')

const { assertRevert } = require('@tps/test-helpers/assertThrow')

const addedRepo = receipt =>
  web3.toAscii(receipt.logs.filter(x => x.event == 'RepoAdded')[0].args.repoId)
const addedBounties = receipt =>
  receipt.logs.filter(x => x.event == 'BountyAdded')[2]
const addedBountyInfo = receipt =>
  receipt.logs.filter(x => x.event == 'BountyAdded').map(event => event.args)
const fulfilledBounty = receipt =>
  receipt.logs.filter(x => x.event == 'BountyFulfilled')[0].args

contract('Projects App', accounts => {
  let daoFact,
    bounties,
    bountiesEvents = {},
    app = {},
    vaultBase = {},
    vault = {}

  const root = accounts[0]
  const owner1 = accounts[0] // 0xb421
  const bountyManager = accounts[2]
  const repoRemover = accounts[3]
  const repoIdString = 'MDEwOIJlcG9zaXRvcnkxNjY3MjlyMjY='
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

  before(async () => {
    //Create Base DAO Contracts
    const kernelBase = await Kernel.new(true)
    // implement bountiesEvents so the events are logged by Truffle
    ////console.log('Bounties Addresses: ', process.env.BOUNT_ADDR.split(' '))
    bountiesEvents = BountiesEvents.at('0x72D1Ae1D6C8f3dd444b3D95bAd554Be483082e40')
    const aclBase = await ACL.new()
    const regFact = await EVMScriptRegistryFactory.new()
    daoFact = await DAOFactory.new(
      kernelBase.address,
      aclBase.address,
      regFact.address
    )
  })

  beforeEach(async () => {
    //Deploy Base DAO Contracts
    const r = await daoFact.newDAO(root)
    const dao = Kernel.at(
      r.logs.filter(l => l.event == 'DeployDAO')[0].args.dao
    )

    const acl = ACL.at(await dao.acl())

    //Create DAO admin role
    await acl.createPermission(
      root,
      dao.address,
      await dao.APP_MANAGER_ROLE(),
      root,
      { from: root }
    )

    //Deploy Contract to be tested
    // TODO: Revert to use regular function call when truffle gets updated
    // read: https://github.com/AutarkLabs/planning-suite/pull/243
    let receipt = await dao.newAppInstance(
      '0x1234',
      (await Projects.new()).address,
      0x0,
      false,
      { from: root }
    )
    app = Projects.at(
      receipt.logs.filter(l => l.event == 'NewAppProxy')[0].args.proxy
    )

    // create ACL permissions
    await acl.createPermission(
      owner1,
      app.address,
      await app.ADD_REPO_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.FUND_ISSUES_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.FUND_OPEN_ISSUES_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.REMOVE_ISSUES_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.UPDATE_BOUNTIES_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      repoRemover,
      app.address,
      await app.REMOVE_REPO_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      root,
      app.address,
      await app.CURATE_ISSUES_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.REVIEW_APPLICATION_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      bountyManager,
      app.address,
      await app.WORK_REVIEW_ROLE(),
      root,
      { from: root }
    )

    await acl.createPermission(
      root,
      app.address,
      await app.CHANGE_SETTINGS_ROLE(),
      root,
      { from: root }
    )

    // Create mock Bounties contract object
    // This address is generated using the seed phrase in the test command
    bounties = { address: '0x72D1Ae1D6C8f3dd444b3D95bAd554Be483082e40'.toLowerCase() }
    alternateBounties = { address: '0xDAaA2f5fbF606dEfa793984bd3615c909B1a3C93'.toLowerCase() }
    vaultBase = await Vault.new()
    const vaultReceipt = await dao.newAppInstance('0x5678', vaultBase.address, '0x', false, { from: root })
    vault = Vault.at(vaultReceipt.logs.filter(l => l.event == 'NewAppProxy')[0].args.proxy)
    await vault.initialize()
    await acl.createPermission(
      app.address,
      vault.address,
      await vault.TRANSFER_ROLE(),
      root,
      { from: root }
    )

    //bounties = StandardBounties.at(registry.address)

  })

  context('pre-initialization', () => {
    it('will not initialize with invalid vault address', async () =>{
      return assertRevert(async () => {
        await app.initialize(
          bounties.address,
          ZERO_ADDR,
        )
      })
    })
    
    it('will not initialize with invalid bounties address', async () =>{
      return assertRevert(async () => {
        await app.initialize(
          ZERO_ADDR,
          vault.address,
        )
      })
    })
  })
  context('post-initialization', () => {
    beforeEach(async () =>{
      await app.initialize(bounties.address, vault.address)
    })

    context('creating and retrieving repos and bounties', () => {
      let repoId

      beforeEach(async () => {
        repoId = addedRepo(
          await app.addRepo(
            repoIdString, // repoId
            { from: owner1 }
          )
        )
      })

      it('creates a repo id entry', async () => {
        assert.equal(
          repoId,
          repoIdString, // TODO: extract to a variable
          'repo is created and ID is returned'
        )
        assert.isTrue(await app.isRepoAdded(repoId), 'repo should have been removed')
      })

      it('retrieve repo array length', async () => {
        const repolength = await app.getReposCount()
        assert(repolength, 1, 'valid repo length returned')
      })

      it('retrieve repo information successfully', async () => {
        const repoInfo = await app.getRepo(repoId, { from: owner1 })
        const result = repoInfo // get repo index on the registry
        assert.equal(
          result,
          0, // repoIndex
          'valid repo info returned'
        )
      })

      it('can remove repos', async () => {
        repoId2 = addedRepo(
          await app.addRepo(
            'MDawOlJlcG9zaXRvcnk3NTM5NTIyNA==', // repoId
            { from: owner1 }
          )
        )
        repoId3 = addedRepo(
          await app.addRepo(
            'DRawOlJlcG9zaXRvcnk3NTM5NTIyNA==', // repoId
            { from: owner1 }
          )
        )
        await app.removeRepo(repoId3, { from: repoRemover })
        assert.isFalse(await app.isRepoAdded(repoId3), 'repo at end of array should have been removed')
        assert.isTrue(await app.isRepoAdded(repoId2), 'repo2 should still be accessible')

        repoId3 = addedRepo(
          await app.addRepo(
            'DRawOlJlcG9zaXRvcnk3NTM5NTIyNA==', // repoId
            { from: owner1 }
          )
        )
        await app.removeRepo(repoId2, { from: repoRemover })
        assert.isFalse(await app.isRepoAdded(repoId2), 'repo at in the middle of the array should have been removed')
        assert.isTrue(await app.isRepoAdded(repoId3), 'repo3 should still be accessible')

        repoId2 = addedRepo(
          await app.addRepo(
            'MDawOlJlcG9zaXRvcnk3NTM5NTIyNA==', // repoId
            { from: owner1 }
          )
        )
        await app.removeRepo(repoId, { from: repoRemover })
        assert.isFalse(await app.isRepoAdded(repoId), 'repo in the middle of the array should have been removed')
        assert.isTrue(await app.isRepoAdded(repoId2), 'repo2 should still be accessible')
      })

      context('issue, fulfill, and accept fulfillment for bounties', () => {
        let issueReceipt
        const issueNumber = 1

        beforeEach('issue bulk bounties', async () => {
          issueReceipt = addedBountyInfo(
            await app.addBounties(
              Array(3).fill(repoId),
              [ 1, 2, 3 ],
              [ 10, 20, 30 ],
              [ Date.now() + 86400, Date.now() + 86400, Date.now() + 86400 ],
              [ 0, 0, 0 ],
              [ 0, 0, 0 ],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
              'something',
              { from: bountyManager, value: 60 }
            )
          )
        })

        it('verifies bounty data contains correct details in emitted event and contract state', async () => {
          issueReceipt.forEach((bounty, index) => {
            assert.deepEqual(
              {
                repoId: '0x4d4445774f494a6c6347397a61585276636e6b784e6a59334d6a6c794d6a593d',
                issueNumber: new web3.BigNumber(index+1),
                bountySize: new web3.BigNumber((index+1)*10),
                registryId: new web3.BigNumber(index)
              },
              bounty
            )
          })
          const issueNumbers = issueReceipt.map(bounty => bounty.issueNumber)
          const issueData1 = await app.getIssue(repoId, issueNumbers[0])
          assert.deepEqual(
            [
              true,
              new web3.BigNumber(0),
              false,
              new web3.BigNumber(10),
              '0x0000000000000000000000000000000000000000'
            ],
            issueData1
          )
          const issueData2 = await app.getIssue(repoId, issueNumbers[1])
          assert.deepEqual(
            [
              true,
              new web3.BigNumber(1),
              false,
              new web3.BigNumber(20),
              '0x0000000000000000000000000000000000000000'
            ],
            issueData2
          )
          const issueData3 = await app.getIssue(repoId, issueNumbers[2])
          assert.deepEqual(
            [
              true,
              new web3.BigNumber(2),
              false,
              new web3.BigNumber(30),
              '0x0000000000000000000000000000000000000000'
            ],
            issueData3
          )
        })

        it('can update bounty information', async () => {
          await app.updateBounty(
            repoId,
            issueNumber,
            'example data',
            Date.now() + 96400,
            'example description',
            { from: bountyManager }
          )
        })

        it('allows users to request assignment', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          response = await app.getApplicant(repoId, issueNumber, 0)
          assert.strictEqual(response[0], root, 'applicant address incorrect')
          assert.strictEqual(
            response[1],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            'application IPFS hash incorrect'
          )
        })

        it('users cannot apply for a given issue more than once', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          assertRevert(async () => {
            await app.requestAssignment(
              repoId,
              issueNumber,
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
              { from: root }
            )
          })
        })

        it('cannot approve assignment if application was not created', async () => {
          return assertRevert(async () => {
            await app.reviewApplication(
              repoId,
              issueNumber,
              ZERO_ADDR,
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
              true,
              { from: bountyManager }
            )
          })
        })

        it('assign tasks to applicants', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, 1)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )

          const issue = await app.getIssue(repoId, 1)
          assert.strictEqual(issue[4], root, 'assignee address incorrect')
        })

        it('approve and reject assignment request', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, 1)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          assert.strictEqual(
            applicant[2].toNumber(),
            0,
            'assignment request status is not Unreviewed'
          )

          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          assert.strictEqual(
            applicant[2].toNumber(),
            1,
            'assignment request status is not Accepted'
          )

          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            false,
            { from: bountyManager }
          )
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          assert.strictEqual(
            applicant[2].toNumber(),
            2,
            'assignment request status is not Rejected'
          )
        })

        it('work can be rejected', async () => {
          const bountyId = (await app.getIssue(repoId, issueNumber))[1].toString()
          //console.log(bountyId)
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, 1)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )

          await bountiesEvents.fulfillBounty(root, bountyId, [root],'test')

          await app.reviewSubmission(
            repoId,
            issueNumber,
            0,
            false,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDl',
            [0],
            { from: bountyManager }
          )
          //assert(false, 'show events')
        })

        it('work can be accepted', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, 1)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )
          const bountyId = (await app.getIssue(repoId, issueNumber))[1].toString()
          //console.log(bountyId)
          await bountiesEvents.fulfillBounty(root, bountyId, [root],'test')

          await app.reviewSubmission(
            repoId,
            issueNumber,
            0,
            true,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDl',
            [10],
            { from: bountyManager }
          )
          //assert(false, 'log events')
        })

        it('work cannot be accepted twice', async () => {
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, 1)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )
          const bountyId = (await app.getIssue(repoId, issueNumber))[1].toString()
          //console.log(bountyId)
          await bountiesEvents.fulfillBounty(root, bountyId, [root],'test')

          await app.reviewSubmission(
            repoId,
            issueNumber,
            0,
            true,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDl',
            [10],
            { from: bountyManager }
          )

          return assertRevert(async () => {
            await app.reviewSubmission(
              repoId,
              issueNumber,
              0,
              true,
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDl',
              [10],
              { from: bountyManager }
            )
          })
        })

        it('can issue bulk token bounties', async () => {
          let token = {}

          token = await MiniMeToken.new(
            ZERO_ADDR,
            ZERO_ADDR,
            0,
            'n',
            0,
            'n',
            true
          ) // empty parameters minime
          await token.generateTokens(vault.address, 6)
          issueReceipt = await addedBountyInfo(
            await app.addBounties(
              Array(3).fill(repoId),
              [ 1, 2, 3 ],
              [ 1, 2, 3 ],
              [ Date.now() + 86400, Date.now() + 86400, Date.now() + 86400 ],
              [ 20, 20, 20 ],
              [ token.address, token.address, token.address ],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
              'something',
              { from: bountyManager, }
            )
          )
          issueReceipt.forEach((bounty, index) => {
            assert.deepEqual(
              {
                repoId: '0x4d4445774f494a6c6347397a61585276636e6b784e6a59334d6a6c794d6a593d',
                issueNumber: new web3.BigNumber(index+1),
                bountySize: new web3.BigNumber(index+1),
                registryId: new web3.BigNumber(bounty.registryId)
              },
              bounty
            )
            assert.isAbove(Number(bounty.registryId), 0, 'a non-zero bounty Id should be returned from standard bounties')
          })
        })

        it('can issue bulk ETH bounties from the vault', async () => {
          await vault.deposit(0, 6, { value: 6 })
          issueReceipt = await addedBountyInfo(
            await app.addBounties(
              Array(3).fill(repoId),
              [ 1, 2, 3 ],
              [ 1, 2, 3 ],
              [ Date.now() + 86400, Date.now() + 86400, Date.now() + 86400 ],
              Array(3).fill(1),
              Array(3).fill(0),
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
              'something',
              { from: bountyManager, }
            )
          )
          issueReceipt.forEach((bounty, index) => {
            assert.deepEqual(
              {
                repoId: '0x4d4445774f494a6c6347397a61585276636e6b784e6a59334d6a6c794d6a593d',
                issueNumber: new web3.BigNumber(index+1),
                bountySize: new web3.BigNumber(index+1),
                registryId: new web3.BigNumber(bounty.registryId)
              },
              bounty
            )
            assert.isAbove(Number(bounty.registryId), 0, 'a non-zero bounty Id should be returned from standard bounties')
          })
        })
      })

      context('issue open bounties', () => {
        let issueReceipt

        beforeEach('issue bulk bounties', async () => {
          issueReceipt = addedBountyInfo(
            await app.addBountiesNoAssignment(
              Array(3).fill(repoId),
              [ 1, 2, 3 ],
              [ 10, 20, 30 ],
              [ Date.now() + 86400, Date.now() + 86400, Date.now() + 86400 ],
              [ 0, 0, 0 ],
              [ 0, 0, 0 ],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
              'something',
              { from: bountyManager, value: 60 }
            )
          )
        })

        it('verifies bounty data contains correct details in emitted event and contract state', async () => {
          issueReceipt.forEach((bounty, index) => {
            assert.deepEqual(
              {
                repoId: '0x4d4445774f494a6c6347397a61585276636e6b784e6a59334d6a6c794d6a593d',
                issueNumber: new web3.BigNumber(index+1),
                bountySize: new web3.BigNumber((index+1)*10),
                registryId: new web3.BigNumber(bounty.registryId)
              },
              bounty
            )
          })
        })

        it('cannot assign an open bounty', async () => {
          return assertRevert(async () => {
            await app.reviewApplication(
              repoId,
              1,
              0,
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
              true,
              { from: bountyManager }
            )
          })
        })
      }) 

      context('bounty killing', async () => {

        it('Bounty Properties are reset on issues with killed bounties', async () => {
          const issueNumber = 6
          await app.addBounties(
            [repoId], 
            [issueNumber], 
            [10],
            [Date.now() + 86400], 
            [0], 
            [0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
            'test description', 
            { from: bountyManager, value: 10 }
          )
          const liveIssue = await app.getIssue(repoId, issueNumber)
          let hasBounty = liveIssue[0]
          assert.isTrue(hasBounty)
	        await app.removeBounties(
            [repoId], 
            [issueNumber], 
            'test removal',
            { from: bountyManager }
          )
          const deadIssue = await app.getIssue(repoId, issueNumber)
          hasBounty = deadIssue[0]
          assert.isFalse(hasBounty)
          bountySize = deadIssue[3]
          assert.equal(bountySize, 0)
          //assert(false, 'log events')
        })

        it('ETH refund appears in the vault', async () => {
          const issueNumber = 6
          const initialBalance = web3.eth.getBalance(vault.address)
          await app.addBounties(
            [repoId], 
            [issueNumber], 
            [10],
            [Date.now() + 86400], 
            [0], 
            [0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
            'test description', 
            { from: bountyManager, value: 10 }
          )
          const liveIssue = await app.getIssue(repoId, issueNumber)
          let hasBounty = liveIssue[0]
          assert.isTrue(hasBounty)
	        await app.removeBounties(
            [repoId], 
            [issueNumber], 
            'test removal',
            { from: bountyManager }
          )

          const finalBalance = web3.eth.getBalance(vault.address)
          assert.strictEqual(finalBalance.sub(initialBalance).toNumber(), 10)
          
        })

        it('refunds tokens to vault', async () => {
          let token = {}

          token = await MiniMeToken.new(
            ZERO_ADDR,
            ZERO_ADDR,
            0,
            'n',
            0,
            'n',
            true
          ) // empty parameters minime
          await token.generateTokens(vault.address, 5)
          const issueNumber = 1
          const initialBalance = (await vault.balance(token.address)).toString()
          issueReceipt = await addedBountyInfo(
            await app.addBounties(
              [repoId],
              [issueNumber],
              [5],
              [Date.now() + 86400],
              [20],
              [token.address],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
              'something',
              { from: bountyManager, }
            )
          )
          const liveIssue = await app.getIssue(repoId, issueNumber)
          let hasBounty = liveIssue[0]
          assert.isTrue(hasBounty)
	        await app.removeBounties(
            [repoId], 
            [issueNumber], 
            'test removal',
            { from: bountyManager }
          )
          const finalBalance = (await vault.balance(token.address)).toString()
          assert.strictEqual(finalBalance, initialBalance)
        })

        it('bounty doesn\'t exist', async () => {
          await truffleAssert.fails(
            app.removeBounties([repoId], [1], 'reasons', { from: bountyManager }),
            truffleAssert.ErrorType.REVERT)
        })

        it('the repo array length can\'t exceed 256 in length', async () => {
          await truffleAssert.fails(
            app.removeBounties(
              Array(256).fill(repoId), 
              Array(256).fill(6),
              'reasons',
              { from: bountyManager }),
            truffleAssert.ErrorType.REVERT,
            // 'LENGTH_EXCEEDED'
          )
        })

        it('the issue array length can\'t exceed 256 in length', async () => {
	      await truffleAssert.fails(
            app.removeBounties(
              [ repoId, repoId ], 
              Array(256).fill(6),
              'reasons',
              { from: bountyManager }),
            truffleAssert.ErrorType.REVERT,
            // 'LENGTH_EXCEEDED'
          )
        })

        it('the array arguments must have the same length', async () => {
          const issueNumbers = [ 6, 7 ]
          const bountySizes = [ web3.toWei(1), web3.toWei(2) ]
          const value = web3.toWei(3)
          await app.addBounties(
            [ repoId, repoId ], 
            issueNumbers, bountySizes,
            [ Date.now() + 86400, Date.now() + 86400 ], 
            [ 0, 0 ], 
            [ 0, 0 ],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
            'test description', { from: bountyManager, value: value })
	        await truffleAssert.fails(
            app.removeBounties([ repoId, repoId ], [6], 'reasons', { from: bountyManager }),
            truffleAssert.ErrorType.REVERT,
            // 'LENGTH_MISMATCH'
          )
        })

        it('can\'t kill a bounty twice', async () => {
          const issueNumber = 6
          await app.addBounties(
            [repoId], 
            [issueNumber], 
            [10], 
            [Date.now() + 86400],
            [0], 
            [0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
            'test description', { from: bountyManager, value: 10 })
          await app.removeBounties([repoId],[issueNumber], 'reasons', {
            from: bountyManager })
          await truffleAssert.fails(
            app.removeBounties([repoId], [issueNumber], 'reasons', { from: bountyManager }),
            truffleAssert.ErrorType.REVERT,
            // 'BOUNTY_REMOVED'
          )
        })

        it('can\'t kill a bounty that doesn\'t exist', async () => {
          const issueNumber = 6
          return assertRevert(async () => {
            await app.removeBounties([repoId], [issueNumber], 'reasons', { from: bountyManager })
          })
        })

        it('can\'t kill a fulfilled bounty', async () => {
          const issueNumber = 6
          await app.addBounties(
            [repoId], [issueNumber], [10], [Date.now() + 86400],
            [0], [0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDCQmVtYjNij3KeyGmcgg7yVXWskLaBtov3UYL9pgcGK3MCWuQmR45FmbVVrixReBwJkhEKde2qwHYaQzGxu4ZoDeswuF9w',
            'test description', { from: bountyManager, value: 10 })
          await app.requestAssignment(
            repoId,
            issueNumber,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDd',
            { from: root }
          )
          applicantQty = await app.getApplicantsLength(repoId, issueNumber)
          applicant = await app.getApplicant(
            repoId,
            issueNumber,
            applicantQty.toNumber() - 1
          )
          await app.reviewApplication(
            repoId,
            issueNumber,
            applicant[0],
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDe',
            true,
            { from: bountyManager }
          )
          const bountyId = (await app.getIssue(repoId, issueNumber))[1].toString()
          //console.log(bountyId)
          await bountiesEvents.fulfillBounty(root, bountyId, [root],'test')

          await app.reviewSubmission(
            repoId,
            issueNumber,
            0,
            true,
            'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDl',
            [10],
            { from: bountyManager }
          )
          await truffleAssert.fails(
            app.removeBounties([repoId], [issueNumber], 'reasons', { from: bountyManager }),
            truffleAssert.ErrorType.REVERT,
            // 'BOUNTY_FULFILLED'
          )
        })

        it('cannot create bounties with ERC 721 tokens', async () => {
          const issueNumber = 7
          return assertRevert(async () => {
            await app.addBounties(
              [repoId],
              [issueNumber],
              [5],
              [Date.now() + 86400],
              [721],
              [0],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
              'something',
              { from: bountyManager, }
            )
          })
        })

        it('cannot create bounties with token type 0 and a non-zero token address', async () => {
          const issueNumber = 7
          return assertRevert(async () => {
            await app.addBounties(
              [repoId],
              [issueNumber],
              [5],
              [Date.now() + 86400],
              [1],
              [1],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
              'something',
              { from: bountyManager, }
            )
          })
        })
        it('cannot create bounties with token type 1 and a non-zero token address', async () => {
          const issueNumber = 7
          return assertRevert(async () => {
            await app.addBounties(
              [repoId],
              [issueNumber],
              [5],
              [Date.now() + 86400],
              [0],
              [1],
              'QmbUSy8HCn8J4TMDRRdxCbK2uCCtkQyZtY6XYv3y7kLgDC',
              'something',
              { from: bountyManager, }
            )
          })
        })
      })
    })

    context('issue curation', () => {
    // TODO: We should create every permission for every test this way to speed up testing
    // TODO: Create an external helper function that inits acl and sets permissions
      before(async () => {})
      it('should curate a multiple issues', async () => {
        const unusedAddresses = accounts.slice(0, 4)
        const zeros = new Array(unusedAddresses.length).fill(0)
        const issuePriorities = zeros
        const issueDescriptionIndices = zeros
        const unused_issueDescriptions = ''
        const issueRepos = zeros
        const issueNumbers = zeros
        const unused_curationId = 0
        const description = 'description'
        await app.curateIssues(
          unusedAddresses,
          issuePriorities,
          issueDescriptionIndices,
          unused_issueDescriptions,
          description,
          issueRepos,
          issueNumbers,
          unused_curationId
        )
      // assert()
      })
      context('invalid issue curation operations', () => {
        it('should revert on issueDescriptionindices and priorities array length mismatch', async () => {
          const unusedAddresses = accounts.slice(0, 4)
          const zeros = new Array(unusedAddresses.length).fill(0)
          const issuePriorities = zeros
          const issueDescriptionIndices = zeros.slice(0, 3)
          const unused_issueDescriptions = ''
          const issueRepos = zeros
          const issueNumbers = zeros
          const unused_curationId = 0
          const description = 'description'
          assertRevert(async () => {
            await app.curateIssues(
              unusedAddresses,
              issuePriorities,
              issueDescriptionIndices,
              unused_issueDescriptions,
              description,
              issueRepos,
              issueNumbers,
              unused_curationId
            )
          })
        })
        it('should revert on IssuedescriptionIndices and issueRepos array length mismatch', async () => {
          const unusedAddresses = accounts.slice(0, 4)
          const zeros = new Array(unusedAddresses.length).fill(0)
          const issuePriorities = zeros
          const issueDescriptionIndices = zeros
          const unused_issueDescriptions = ''
          const issueRepos = zeros.slice(0, 3)
          const issueNumbers = zeros
          const unused_curationId = 0
          const description = 'description'
          assertRevert(async () => {
            await app.curateIssues(
              unusedAddresses,
              issuePriorities,
              issueDescriptionIndices,
              unused_issueDescriptions,
              description,
              issueRepos,
              issueNumbers,
              unused_curationId
            )
          })
        })
        it('should revert on IssueRepos and IssuesNumbers array length mismatch', async () => {
          const unusedAddresses = accounts.slice(0, 4)
          const zeros = new Array(unusedAddresses.length).fill(0)
          const issuePriorities = zeros
          const issueDescriptionIndices = zeros
          const unused_issueDescriptions = ''
          const issueRepos = zeros
          const issueNumbers = zeros.slice(0, 3)
          const unused_curationId = 0
          const description = 'description'
          assertRevert(async () => {
            await app.curateIssues(
              unusedAddresses,
              issuePriorities,
              issueDescriptionIndices,
              unused_issueDescriptions,
              description,
              issueRepos,
              issueNumbers,
              unused_curationId
            )
          })
        })
      })
    })

    context('settings management', () => {
      it('cannot accept experience arrays of differenct length', async () => {
        return assertRevert( async () => {
          await app.changeBountySettings(
            [ 100, 300, 500, 1000 ], // xp multipliers
            [
            // Experience Levels
              web3.fromAscii('Beginner'),
              web3.fromAscii('Intermediate'),
              web3.fromAscii('Advanced'),
            ],
            1, // baseRate
            336, // bountyDeadline
            ZERO_ADDR, // bountyCurrency
            bounties.address // bountyAllocator
          )
        })
      })
      it('can change Bounty Settings', async () => {
        await app.changeBountySettings(
          [ 100, 300, 500, 1000 ], // xp multipliers
          [
          // Experience Levels
            web3.fromAscii('Beginner'),
            web3.fromAscii('Intermediate'),
            web3.fromAscii('Advanced'),
            web3.fromAscii('Expert'),
          ],
          1, // baseRate
          336, // bountyDeadline
          ZERO_ADDR, // bountyCurrency
          bounties.address // bountyAllocator
        )

        response = await app.getSettings()

        expect(response[0].map(x => x.toNumber())).to.have.ordered.members([
          100,
          300,
          500,
          1000,
        ])
        const xpLvlDescs = response[1].map(x => web3.toUtf8(x))
        expect(xpLvlDescs).to.have.ordered.members([
          'Beginner',
          'Intermediate',
          'Advanced',
          'Expert',
        ])

        assert.strictEqual(response[2].toNumber(), 1, 'baseRate Incorrect')
        assert.strictEqual(
          response[3].toNumber(),
          336,
          'bounty deadline inccorrect'
        )
        assert.strictEqual(
          response[4],
          '0x0000000000000000000000000000000000000000',
          'Token Address incorrect'
        )
        assert.strictEqual(
          response[5],
          bounties.address,
          'StandardBounties Contract address incorrect'
        )
      })

      it('cannot update bounties contract with a 0x0 address', async () => {
        return assertRevert( async () => {
          await app.changeBountySettings(
            [ 100, 300, 500, 1000 ], // xp multipliers
            [
              // Experience Levels
              web3.fromAscii('Beginner'),
              web3.fromAscii('Intermediate'),
              web3.fromAscii('Advanced'),
              web3.fromAscii('Expert'),
            ],
            1, // baseRate
            336, // bountyDeadline
            ZERO_ADDR, // bountyCurrency
            0 // bountyAllocator
          )
        })
      })

      it('cannot update bounties contract with contract of invalid size', async () => {
        return assertRevert( async () => {
          await app.changeBountySettings(
            [ 100, 300, 500, 1000 ], // xp multipliers
            [
              // Experience Levels
              web3.fromAscii('Beginner'),
              web3.fromAscii('Intermediate'),
              web3.fromAscii('Advanced'),
              web3.fromAscii('Expert'),
            ],
            1, // baseRate
            336, // bountyDeadline
            ZERO_ADDR, // bountyCurrency
            app.address // bountyAllocator
          )
        })
      })

      it('can update bounties contract with a new valid contract instance', async () => {
        await app.changeBountySettings(
          [ 100, 300, 500, 1000 ], // xp multipliers
          [
            // Experience Levels
            web3.fromAscii('Beginner'),
            web3.fromAscii('Intermediate'),
            web3.fromAscii('Advanced'),
            web3.fromAscii('Expert'),
          ],
          1, // baseRate
          336, // bountyDeadline
          ZERO_ADDR, // bountyCurrency
          alternateBounties.address // bountyAllocator
        )
      })
    })

    context('invalid operations', () => {
      it('cannot add a repo that is already present', async () => {
        await app.addRepo('abc', { from: owner1 })

        assertRevert(async () => {
          await app.addRepo('abc', { from: owner1 })
        })
      })
      it('cannot remove a repo that was never added', async () => {
        assertRevert(async () => {
          await app.removeRepo('99999', { from: repoRemover })
        })
      })
      it('cannot retrieve a removed Repo', async () => {
        const repoId = addedRepo(
          await app.addRepo('abc', { from: owner1 })
        )
        await app.removeRepo(repoId, { from: repoRemover })
        // const result = await app.getRepo(repoId)
        assertRevert(async () => {
          await app.getRepo(repoId, { from: repoRemover })
        })
      // assert.equal(
      //   web3.toAscii(result[0]).replace(/\0/g, ''),
      //   '',
      //   'repo returned'
      // )
      })

      it('cannot add bounties to unregistered repos', async () => {
        assertRevert(async () => {
          await app.addBounties(
            Array(3).fill('0xdeadbeef'),
            [ 1, 2, 3 ],
            [ 10, 20, 30 ],
            'something cool',
            {
              from: bountyManager,
            }
          )
        })
      })
    })
  })
})
