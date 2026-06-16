import * as React from 'react'
import { render } from '@react-email/components'
import { template } from '../src/lib/email-templates/hardcore-orientation'

const el = React.createElement(template.component, { firstName: 'Ervin' })
const html = await render(el)
const text = await render(el, { plainText: true })

await Bun.write('/tmp/orient.html', html)
await Bun.write('/tmp/orient.txt', text)
console.log('ok', html.length, text.length)
