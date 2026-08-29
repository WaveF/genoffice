import type { ReactNode } from 'react'
import {
  IconColDelete,
  IconColInsertLeft,
  IconColInsertRight,
  IconRowDelete,
  IconRowInsertAbove,
  IconRowInsertBelow,
  IconTableDelete,
} from './icons'
import type { SourceTableOperation } from '../markdown/sourceCommands'

function Btn({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`tm-btn${danger ? ' danger' : ''}`}
      aria-label={title}
      data-tip={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Source-mode counterpart of TableMenu: it rewrites the active GFM table. */
export function SourceTableMenu({ onOperation }: { onOperation: (operation: SourceTableOperation) => void }) {
  const ICON = 15
  return (
    <div className="source-table-menu" aria-label="Markdown table actions">
      <Btn title="Insert row above" onClick={() => onOperation('add_row_before')}>
        <IconRowInsertAbove size={ICON} />
      </Btn>
      <Btn title="Insert row below" onClick={() => onOperation('add_row_after')}>
        <IconRowInsertBelow size={ICON} />
      </Btn>
      <Btn title="Delete row" danger onClick={() => onOperation('delete_row')}>
        <IconRowDelete size={ICON} />
      </Btn>
      <span className="tm-sep" />
      <Btn title="Insert column left" onClick={() => onOperation('add_column_left')}>
        <IconColInsertLeft size={ICON} />
      </Btn>
      <Btn title="Insert column right" onClick={() => onOperation('add_column_right')}>
        <IconColInsertRight size={ICON} />
      </Btn>
      <Btn title="Delete column" danger onClick={() => onOperation('delete_column')}>
        <IconColDelete size={ICON} />
      </Btn>
      <span className="tm-sep" />
      <Btn title="Delete table" danger onClick={() => onOperation('delete_table')}>
        <IconTableDelete size={ICON} />
      </Btn>
    </div>
  )
}
