import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'

import { Info, Text, TextInput, theme, SafeLink, DropDown, IconFundraising, Field } from '@aragon/ui'

import { Form, FormField } from '../../Form'
import { DateInput, InputDropDown } from '../../../../../../shared/ui'
import { format } from 'date-fns'
import BigNumber from 'bignumber.js'
import { millisecondsToBlocks, millisecondsToQuarters, MILLISECONDS_IN_A_QUARTER } from '../../../../../../shared/ui/utils'
import { displayCurrency, toCurrency } from '../../../utils/helpers'
import { isAddress } from '../../../utils/web3-utils'
import { ETHER_TOKEN_VERIFIED_BY_SYMBOL } from '../../../utils/verified-tokens'
import TokenSelectorInstance from './TokenSelectorInstance'

const rewardTypes = [ 'Merit Reward', 'Dividend' ]
const referenceAssets = [ 'ABC', 'XYZ' ]
const currencies = [ 'ETH', 'DAI' ]
const disbursementCycles = ['Quarterly']
const disbursementCyclesSummary = ['quarterly cycle']
const disbursementDates = [ '1 week', '2 weeks' ]
const disbursementDatesItems = disbursementDates.map(item => 'Cycle end + ' + item)
import tokenBalanceOfAbi from '../../../../../shared/json-abis/token-balanceof.json'
import tokenBalanceOfAtAbi from '../../../../../shared/json-abis/token-balanceofat.json'
import tokenCreationBlockAbi from '../../../../../shared/json-abis/token-creationblock.json'
import tokenSymbolAbi from '../../../../../shared/json-abis/token-symbol.json'
const tokenAbi = [].concat(tokenBalanceOfAbi, tokenBalanceOfAtAbi, tokenCreationBlockAbi, tokenSymbolAbi)

const INTIAL_STATE = {
  customToken: {
    address: '',
    value: '',
    isVerified: null,
  },
}

class NewReward extends React.Component {
  static propTypes = {
    vaultBalance: PropTypes.string.isRequired,
    onNewReward: PropTypes.func.isRequired,
  }



  constructor(props) {
    super(props)
    this.getCurrentBlock()
    this.state = {
      description: '',
      amount: 0,
      amountCurrency: 0,
      dateStart: new Date(),
      dateEnd: new Date(),
      rewardType: 0,
      refTokens: undefined,
      referenceAsset: 0,
      disbursementCycle: 0,
      disbursementDate: 0,
      occurances: 0,
      label: 'Token',
      labelCustomToken: 'Token address or symbol',
      ...INTIAL_STATE,
    }
  }

  getCurrentBlock = async () => {
    const currentBlock = await this.props.app.web3Eth('getBlockNumber').toPromise()
    const startBlock = currentBlock + millisecondsToBlocks(Date.now(), this.state.dateStart)
    this.setState({ currentBlock, startBlock })
  }

  changeField = ({ target: { name, value } }) =>
    this.setState({ [name]: value })

  onSubmit = () => {
    const dataToSend = { ...this.state }
    dataToSend.amount = toCurrency(this.state.amount,this.props.balances[this.state.amountCurrency].decimals)
    dataToSend.currency = this.props.balances[this.state.amountCurrency].address
    dataToSend.disbursementCycle = disbursementCycles[this.state.disbursementCycle]
    dataToSend.disbursementDelay = disbursementDates[this.state.disbursementDate]
    dataToSend.isMerit = !dataToSend.rewardType ? true : false
    dataToSend.referenceAsset = this.state.customToken.isVerified?this.state.customToken.address:this.props.refTokens[this.state.referenceAsset-2].address
    this.props.onNewReward(dataToSend)
  }

  canSubmit = () =>
    !(
      this.state.amount > 0 &&
      this.state.description !== '' &&
      this.state.dateEnd > this.state.dateStart &&
      (
        this.state.referenceAsset > 1 ||
        this.state.customToken.address
      ) &&
      !this.errorPrompt()
    )

  startBeforeTokenCreation = () => (this.state.customToken.startBlock?this.state.customToken.startBlock:this.props.refTokens[this.state.referenceAsset - 2].startBlock) > this.state.startBlock
  disbursementOverflow = () => (this.state.quarterEndDates ? this.state.quarterEndDates.length > 41 : false)
  lowVaultBalance = () => this.props.balances[this.state.amountCurrency].amount / Math.pow(10,this.props.balances[this.state.amountCurrency].decimals) < this.state.amount
  dividendPeriodTooShort = () => (this.state.rewardType > 0 && this.state.occurances === 0)
  errorPrompt = () => (this.showSummary() && (this.startBeforeTokenCreation() || this.disbursementOverflow() || this.lowVaultBalance() || this.dividendPeriodTooShort()))

  showSummary = () => (this.state.referenceAsset > 1 || this.state.customToken.symbol)

  getItems() {
    if (!this.props.refTokens) {
      return ['Tokens Loading...']
    }
    return [ 'Select a token', 'Other…', ...this.getTokenItems() ]
  }

  getTokenItems() {
    return this.props.refTokens
      .filter(token => token.startBlock ? true : false)
      .map(({ address, name, symbol, verified }) => (
        <TokenSelectorInstance
          address={address}
          name={name}
          showIcon={verified}
          symbol={symbol}
        />
      ))
  }

  handleCustomTokenChange = event => {
    const { value } = event.target
    const { network } = this.props

    // Use the verified token address if provided a symbol and it matches
    // The symbols in the verified map are all capitalized
    const resolvedAddress =
      !isAddress(value) && network.type === 'main'
        ? ETHER_TOKEN_VERIFIED_BY_SYMBOL.get(value.toUpperCase()) || ''
        : ''

    if(isAddress(value) || isAddress(resolvedAddress)) {
      this.verifyMinime(resolvedAddress || value, this.props.app, { address: resolvedAddress || value, value })
    }

    this.setState(
      {
        customToken: {
          value,
          address: resolvedAddress,
        },
      },
    )
  }

  verifyMinime = async (tokenAddress, app, tokenState) => {
    console.log('entered verify')
    const token = app.external(tokenAddress, tokenAbi)
    const testAddress = '0xb4124cEB3451635DAcedd11767f004d8a28c6eE7'
    const currentBlock = await app.web3Eth('getBlockNumber').toPromise()
    try {
      const verifiedTests = (await Promise.all([
        await token.balanceOf(testAddress).toPromise(),
        await token.creationBlock().toPromise(),
        await token.balanceOfAt(testAddress,currentBlock).toPromise(),
      ]))
      const isVerified = verifiedTests
        .every(val => Number.isInteger(Number(val)))
      if (verifiedTests[0] !== verifiedTests[2]) {
        console.log('shouldnt be verified: ',false)
        this.setState({ customToken: { ...tokenState, isVerified: false } })
        return false
      }
      console.log('should be verified: ',isVerified)
      this.setState({
        customToken: {
          ...tokenState,
          isVerified: true,
          symbol: await token.symbol().toPromise(),
          startBlock: await token.creationBlock().toPromise(),
        }
      })
      return true
    }
    catch (error) {
      console.log('Is Verified: ', false)
      this.setState({ customToken: { ...tokenState, isVerified: false } })
      return false
    }
  }

  formatDate = date => format(date, 'yyyy-MM-dd')
  changeDate = (dateStart, dateEnd) => {
    const occurances = millisecondsToQuarters(dateStart, dateEnd)
    this.getCurrentBlock()
    this.setState({
      dateStart,
      dateEnd,
      occurances,
      quarterEndDates: [...Array(occurances).keys()]
        .map(occurance => Date.now() + ((occurance + 1) * MILLISECONDS_IN_A_QUARTER)),
    })
  }

  ErrorBox = () => (
    this.errorPrompt() &&
      <React.Fragment>
        <Info.Alert>
          {this.startBeforeTokenCreation() && `The selected start date occurs
          before your reference asset ${(this.state.customToken.symbol ? this.state.customToken.symbol:this.props.refTokens[this.state.referenceAsset-2].symbol)}
          was created. Please choose another date.`}

          {this.disbursementOverflow() && `You have specified a date range that results in
          ${this.state.quarterEndDates.length} disbursements, yet our system can only handle 41.
          Choose an end date no later than ${this.formatDate(this.state.quarterEndDates[40])}.`}

          {this.lowVaultBalance() && `You have specified a reward for
          ${this.state.amount} ${this.props.balances[this.state.amountCurrency].symbol}, yet your vault balance
          is ${this.props.balances[this.state.amountCurrency].amount / Math.pow(10,this.props.balances[this.state.amountCurrency].decimals)}
          ${this.props.balances[this.state.amountCurrency].symbol}. To ensure successful
          execution, specify another amount that does not exceed your balance.`}

          {this.dividendPeriodTooShort() &&
          'Please select a start and end date that are at least as long as the cycle period selected'}
        </Info.Alert>
        <br />
      </React.Fragment>
  )

  rewardMain = (showCustomToken) => (
    <div>
      <FormField
        required
        wide
        label="Reference Asset"
        input={
          <DropDown
            wide
            items={this.getItems()}//this.props.balances.slice(1).map(token => token.symbol)}
            active={this.state.referenceAsset}
            onChange={referenceAsset => this.setState({ referenceAsset, ...INTIAL_STATE })}
          />
        }
      />

      {showCustomToken && (
        <Field label={this.state.labelCustomToken}>
          <TextInput
            placeholder="SYM…"
            value={this.state.customToken.value}
            onChange={this.handleCustomTokenChange}
            required
            wide
          />
        </Field>
      )}

      <FormField
        required
        label="Type"
        input={
          <DropDown
            wide
            items={rewardTypes}
            active={this.state.rewardType}
            onChange={rewardType => this.setState({ rewardType })}
          />
        }
      />
    </div>
  )

  meritDetails = () => (
    <div>
      <RewardRow>
        <FormField
          required
          label="Amount"
          input={
            <InputDropDown
              textInput={{
                name: 'amount',
                value: this.state.amount,
                onChange: this.changeField,
                type: 'number',
                min: '0',
              }}
              dropDown={{
                name: 'amountCurrency',
                items: this.props.balances.map(token => token.symbol),
                active: this.state.amountCurrency,
                onChange: amountCurrency => this.setState({ amountCurrency }),
              }}
            />
          }
        />
        <VaultBalance>
          Vault Balance: {
            BigNumber(this.props.balances[this.state.amountCurrency].amount)
              .div(10**(this.props.balances[this.state.amountCurrency].decimals)).dp(3).toString()
          } {' '} {this.props.balances[this.state.amountCurrency].symbol}
        </VaultBalance>
      </RewardRow>

      <RewardRow>
        <FormField
          label="Period Start"
          required
          input={
            <DateInput
              width="100%"
              name="dateStart"
              value={this.state.dateStart}
              onChange={dateStart => {
                this.getCurrentBlock()
                this.setState({ dateStart })
              }}
            />
          }
        />
        <FormField
          label="Period End"
          required
          input={
            <DateInput
              width="100%"
              name="periodEnd"
              value={this.state.dateEnd}
              onChange={dateEnd => this.setState({ dateEnd })}
            />
          }
        />
      </RewardRow>

      <Separator />

      {this.showSummary() &&
      <Info style={{ marginBottom: '10px' }}>
        <TokenIcon />
        <Summary>
          <p>
            A total of <SummaryBold>{this.state.amount} {this.props.balances[this.state.amountCurrency].symbol}</SummaryBold> will
            be distributed as a reward to addresses that earned <SummaryBold>{(this.state.customToken.symbol ? this.state.customToken.symbol:this.props.refTokens[this.state.referenceAsset-2].symbol)}</SummaryBold> from <SummaryBold>{this.formatDate(this.state.dateStart)}</SummaryBold> to <SummaryBold>{this.formatDate(this.state.dateEnd)}</SummaryBold>.
          </p>
          <p>
            The reward amount will be in proportion to the <SummaryBold>{(this.state.customToken.symbol ? this.state.customToken.symbol:this.props.refTokens[this.state.referenceAsset-2].symbol)}</SummaryBold> earned by each account in the specified period.
          </p>
          <p>
            The reward will be disbursed <SafeLink href="#" target="_blank"><SummaryBold>upon approval of this proposal</SummaryBold></SafeLink>.
          </p>
        </Summary>
      </Info>}
    </div>
  )

  dividendDetails = () => (
    <div>
      <RewardRow>
        <FormField
          required
          label="Amount per cycle"
          input={
            <InputDropDown
              textInput={{
                name: 'amount',
                value: this.state.amount,
                onChange: this.changeField,
                type: 'number',
                min: '0',
              }}
              dropDown={{
                name: 'amountCurrency',
                items: this.props.balances.map(token => token.symbol),
                active: this.state.amountCurrency,
                onChange: amountCurrency => this.setState({ amountCurrency }),
              }}
            />
          }
        />
        <VaultBalance>
          Vault Balance: {
            BigNumber(this.props.balances[this.state.amountCurrency].amount)
              .div(10**(this.props.balances[this.state.amountCurrency].decimals)).dp(3).toString()
          } {' '} {this.props.balances[this.state.amountCurrency].symbol}
        </VaultBalance>
      </RewardRow>

      <RewardRow>
        <FormField
          label="Start date"
          required
          input={
            <DateInput
              width="100%"
              name="dateStart"
              value={this.state.dateStart}
              onChange={dateStart => this.changeDate(dateStart, this.state.dateEnd)}
            />
          }
        />
        <FormField
          label="End date"
          required
          input={
            <DateInput
              width="100%"
              name="dateEnd"
              value={this.state.dateEnd}
              onChange={dateEnd =>this.changeDate(this.state.dateStart,dateEnd)}
            />
          }
        />
      </RewardRow>

      <RewardRow>
        <FormField
          required
          label="Disbursement cycle"
          input={
            <DropDown
              wide
              items={disbursementCycles}
              active={this.state.disbursementCycle}
              onChange={disbursementCycle => this.setState({ disbursementCycle })}
            />
          }
        />
        <FormField
          required
          label="Disbursement date"
          width="180px"
          input={
            <DropDown
              wide
              items={disbursementDatesItems}
              active={this.state.disbursementDate}
              onChange={disbursementDate => this.setState({ disbursementDate })}
            />
          }
        />
      </RewardRow>

      <Separator />
      { (this.showSummary() && this.state.occurances > 0) &&
        <Info style={{ marginBottom: '10px' }}>
          <TokenIcon />
          <Summary>
            <p>
              {'A total of '}
              <SummaryBold>
                {this.state.amount} {this.props.balances[this.state.amountCurrency].symbol}
              </SummaryBold>
              {' will be distributed as a dividend to '}
              <SummaryBold>
                {(this.state.customToken.symbol ? this.state.customToken.symbol:this.props.refTokens[this.state.referenceAsset-2].symbol)}
              </SummaryBold>
              {' holders on a '}
              <SummaryBold>
                {disbursementCyclesSummary[this.state.disbursementCycle]}
              </SummaryBold>
              {', from '}
              <SummaryBold>
                {this.formatDate(this.state.dateStart)}
              </SummaryBold>
              {' to '}
              <SummaryBold>
                {this.formatDate(this.state.dateEnd)}
              </SummaryBold>
              {'with cycles ending on:'}
              {
                this.state.quarterEndDates.map((endTimeStamp, idx) => (
                  <React.Fragment key={idx}>
                    <br />
                    <SummaryBold>
                      {this.formatDate(endTimeStamp)}
                    </SummaryBold>
                  </React.Fragment>
                ))
              }.
            </p>
            <p>
          The dividend amount will be in proportion to the <SummaryBold>{(this.state.customToken.symbol ? this.state.customToken.symbol:this.props.refTokens[this.state.referenceAsset-2].symbol)}</SummaryBold> balance as of the last day of each cycle.
            </p>
            <p>
          The dividend will be disbursed <SummaryBold>{disbursementDates[this.state.disbursementDate]}</SummaryBold> after the end of each cycle.
            </p>
          </Summary>
        </Info>

      }
    </div>
  )


  render() {
    const { dateStart, dateEnd, rewardType, occurances } = this.state
    //if (rewardType === 1) {
    //  console.log('occurances: ', occurances)
    //  console.log('quarter end dates: ', this.state.quarterEndDates)
    //}
    console.log('state: ',this.state)
    console.log('props: ', this.props)
    if (this.state.customToken.isVerified) {
      console.log('startblock error', this.startBeforeTokenCreation())
      console.log('token startblock: ', this.state.customToken.startBlock)
      console.log('period startBlock: ', this.state.startBlock)
    }
    //console.log('refItems: ',this.getItems())
    const showCustomToken = this.state.referenceAsset === 1
    console.log(showCustomToken)
    console.log('show summary: ', this.showSummary())
    //this.state.refTokens && this.state.refTokens.length > 0 && this.verifyMinime(this.state.refTokens[0].address, this.props.app)
    //this.props.app && this.verifyMinime('0x730deb4bfe825EDe71F032FbA5373a6961B0387b', this.props.app)
    return (
      <Form
        onSubmit={this.onSubmit}
        submitText="Submit Reward"
        noSeparator
        submitDisabled={this.canSubmit()}
      >
        <FormField
          label="Description"
          required
          input={
            <TextInput
              name="description"
              wide
              value={this.state.description}
              onChange={this.changeField}
            />
          }
        />

        <Separator />

        {this.rewardMain(showCustomToken)}

        <Separator />

        {this.state.rewardType === 0 ? this.meritDetails() : this.dividendDetails()}
        {this.ErrorBox()}
      </Form>
    )
  }
}
const Summary = styled.div`
  padding-bottom: 2px;
  padding-left: 35px;
  > :not(:last-child) {
    margin-bottom: 10px;
  }
`
const SummaryBold = styled.span`
  font-weight: bold;
  text-decoration: underline;
`
// RewardRow is supposed to have only two elements
const RewardRow = styled.div`
  display: flex;
  align-content: stretch;
  > :first-child {
    width: 50%;
    padding-right: 10px;
  }
  > :last-child {
    width: 50%;
    padding-left: 10px;
  }
`
const Separator = styled.hr`
  height: 1px;
  width: 100%;
  color: ${theme.contentBorder};
  opacity: 0.1;
  margin: 8px 0;
`
const VaultBalance = styled.div`
  display: flex;
  align-items: center;
`
const TokenIcon = styled(IconFundraising)`
float: left;
`
export default NewReward
