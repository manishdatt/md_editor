import { toWebRequest, sendWebResponse } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  const response = await auth.handler(toWebRequest(event))
  return sendWebResponse(event, response)
})