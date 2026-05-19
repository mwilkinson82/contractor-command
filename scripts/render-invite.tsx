import * as React from 'react'
import { render } from '@react-email/components'
import { InviteEmail } from '../src/lib/email-templates/invite'
import fs from 'fs'

const html = await render(React.createElement(InviteEmail, {
  siteName: 'Contractor Circle',
  siteUrl: 'https://app.alpcontractorcircle.com',
  confirmationUrl: 'https://app.alpcontractorcircle.com/welcome?token=preview',
  firstName: 'Cesar',
  discordUrl: 'https://discord.gg/alpcontractorcircle',
  zoomUrl: 'https://us06web.zoom.us/j/0000000000',
}))
fs.writeFileSync('/mnt/documents/welcome-invite-email.html', html)
console.log('written', html.length, 'bytes')
