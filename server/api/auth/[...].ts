import { auth } from '~/server/utils/auth'
import { toWebRequest, sendWebResponse } from 'h3'

export default defineEventHandler(async (event) => {
  const response = await auth.handler(toWebRequest(event))
  return sendWebResponse(event, response)
})