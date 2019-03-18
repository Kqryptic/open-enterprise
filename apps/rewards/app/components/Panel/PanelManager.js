import { SidePanel } from '@aragon/ui'
import PropTypes from 'prop-types'
import React, { Suspense } from 'react'

const camel2title = camelCase =>
  camelCase
    .replace(/([A-Z])/g, match => ` ${match}`)
    .replace(/^./, match => match.toUpperCase())

const dynamicImport = Object.freeze({
  NewReward: () => import('./NewReward'),
  YourReward: () => import('./YourReward'),
  ViewReward: () => import('./ViewReward'),
})

const PANELS = Object.keys(dynamicImport).reduce((obj, item) => {
  obj[item] = item
  return obj
}, {})

const PanelManager = ({ activePanel = null, onClose, ...panelProps }) => {
  const panelTitle = activePanel && camel2title(activePanel)
  const PanelComponent = activePanel && React.lazy(dynamicImport[activePanel])
  return (
    <SidePanel
      title={panelTitle || ''}
      opened={!!activePanel}
      onClose={onClose}
    >
      <Suspense fallback={<div>Loading Panel...</div>}>
        {PanelComponent && <PanelComponent {...panelProps} />}
      </Suspense>
    </SidePanel>
  )
}

PanelManager.propTypes = {
  activePanel: PropTypes.string,
  onClose: PropTypes.func,
}

export default PanelManager
export { PANELS }