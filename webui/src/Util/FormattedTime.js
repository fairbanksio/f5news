import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en.json'
TimeAgo.addDefaultLocale(en)
export const timeAgoShort = (timestamp) =>{
  const timeAgo = new TimeAgo()
  return timeAgo.format(new Date(timestamp*1000), 'twitter')
}