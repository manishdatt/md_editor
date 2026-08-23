const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.DOMParser = dom.window.DOMParser
global.Node = dom.window.Node
global.HTMLElement = dom.window.HTMLElement
global.getComputedStyle = dom.window.getComputedStyle
require('./test_bundle.cjs')
