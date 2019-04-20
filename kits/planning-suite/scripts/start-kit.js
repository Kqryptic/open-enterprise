const PlanningSuite = artifacts.require('PlanningSuite')
const pct16 = x =>
  new web3.BigNumber(x).times(new web3.BigNumber(10).toPower(16))
const getEventResult = (receipt, event, param) =>
  receipt.logs.filter(l => l.event == event)[0].args[param]

// ensure alphabetic order
const defaultOwner =
  process.env.OWNER || '0xb4124cEB3451635DAcedd11767f004d8a28c6eE7'
const defaultPlanningSuiteAddr =
  process.env.PLANNING_SUITE_KIT || '0x3d7034e6cb36ebda9485bf8788f6d1015824fcf9'

module.exports = async (
  truffleExecCallback,
  { owner = defaultOwner, planningSuiteAddr = defaultPlanningSuiteAddr } = {}
) => {
  console.log('Starting Planning Suite Kit... 🚀')

  let daoAddress, tokenAddress
  let vaultAddress, votingAddress

  console.log('setting up support values')
  const neededSupport = pct16(50)
  const minimumAcceptanceQuorum = pct16(20)
  const minParticipationPct = pct16(50)
  const candidateSupportPct = pct16(10)
  const votingTime = 900
  console.log('Creating kit instance at ', planningSuiteAddr)

  kit = await PlanningSuite.at(planningSuiteAddr)
  console.log('kit instance created')
  // aragonId = 'planning-suite-dao-' + Math.floor(Math.random() * 1000)
  // tokenName = 'AutarkToken1'
  // tokenSymbol = 'autark1'
  aragonId = 'testing-dao-xyz'
  tokenName = 'Spice'
  tokenSymbol = 'spice'

  const holders = [owner]
  const stakes = [200e18]

  // create Token
  console.log('Creating token')
  const receiptToken = await kit.newToken(tokenName, tokenSymbol)
  console.log('got here')
  // console.log(accounts)
  tokenAddress = getEventResult(receiptToken, 'DeployToken', 'token')

  console.log('Creating instance:', {
    aragonId,
    holders,
    stakes,
    candidateSupportPct,
    minimumAcceptanceQuorum,
    votingTime,
    owner,
  })

  // create Instance
  receiptInstance = await kit.newInstance(
    aragonId,
    holders,
    stakes,
    neededSupport,
    minimumAcceptanceQuorum,
    votingTime
  )
  // generated apps from dao creation
  daoAddress = getEventResult(receiptInstance, 'DeployInstance', 'dao')
  vaultAddress = getEventResult(receiptInstance, 'DeployInstance', 'vault')
  votingAddress = getEventResult(receiptInstance, 'DeployInstance', 'voting')
  tokenAddress = getEventResult(receiptInstance, 'DeployInstance', 'token')
  console.log('Dao Created', daoAddress)
  console.log('Vault address', vaultAddress)
  // Add PlanningSuite Apps to DAO
  receiptInstance = await kit.newPlanningApps(
    daoAddress,
    vaultAddress,
    votingAddress,
    tokenAddress,
    candidateSupportPct,
    minParticipationPct,
    votingTime
  )
  console.log('Apps added')
}