import * as React from 'react'
import { render } from '@react-email/components'
import { InviteEmail } from '../src/lib/email-templates/invite'
import fs from 'fs'

const html = await render(React.createElement(InviteEmail, {
  siteName: 'Contractor Circle',
  siteUrl: 'https://app.alpcontractorcircle.com',
  confirmationUrl: 'https://app.alpcontractorcircle.com/welcome?token=preview',
  firstName: 'Cesar',
  discordUrl: 'https://discord.gg/yvVN2N3qvN',
  // zoom values intentionally omitted — pulled from src/lib/program.ts
}))
fs.writeFileSync('/mnt/documents/welcome-invite-email.html', html)
console.log('written', html.length, 'bytes')
