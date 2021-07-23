/**
 * @copyright Copyright (c) 2019 Georg Ehrke
 * @author Georg Ehrke <oc.list@georgehrke.com>
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
import { getDurationValueFromFullCalendarDuration } from '../duration'
import getTimezoneManager from '../../services/timezoneDataProviderService'
import logger from '../../utils/logger.js'
import { getObjectAtRecurrenceId } from '../../utils/calendarObject.js'
import { mapEventComponentToEventObject } from '../../models/event'

/**
 * Returns a function to drop an event at a different position
 *
 * @param {object} store The Vuex store
 * @param {object} fcAPI The fullcalendar api
 * @return {Function}
 */
export default function(store, fcAPI) {
	return async function({ event, delta, revert }) {
		const deltaDuration = getDurationValueFromFullCalendarDuration(delta)
		const defaultAllDayDuration = getDurationValueFromFullCalendarDuration(fcAPI.getOption('defaultAllDayEventDuration'))
		const defaultTimedDuration = getDurationValueFromFullCalendarDuration(fcAPI.getOption('defaultTimedEventDuration'))
		const timezoneId = fcAPI.getOption('timeZone')
		let timezone = getTimezoneManager().getTimezoneForId(timezoneId)
		if (!timezone) {
			timezone = getTimezoneManager().getTimezoneForId('UTC')
			logger.error(`EventDrop: Timezone ${timezoneId} not found, falling back to UTC.`)
		}

		if (!deltaDuration || !defaultAllDayDuration || !defaultTimedDuration) {
			revert()
			return
		}

		const objectId = event.extendedProps.objectId
		const recurrenceId = event.extendedProps.recurrenceId
		const recurrenceIdDate = new Date(recurrenceId * 1000)

		let calendarObject
		try {
			calendarObject = await store.dispatch('getEventByObjectId', { objectId })
		} catch (error) {
			console.debug(error)
			revert()
			return
		}

		const eventComponent = getObjectAtRecurrenceId(calendarObject, recurrenceIdDate)
		if (!eventComponent) {
			console.debug('Recurrence-id not found')
			revert()
			return
		}

		try {
			// shiftByDuration may throw exceptions in certain cases
			eventComponent.shiftByDuration(deltaDuration, event.allDay, timezone, defaultAllDayDuration, defaultTimedDuration)
		} catch (error) {
			store.commit('resetCalendarObjectToDav', {
				calendarObject,
			})
			console.debug(error)
			revert()
			return
		}

		// Show a modal to let the user decide whether to update this or all future instances.
		// Non-recurring events or recurrence exceptions can just be dropped and don't require
		// extra user interaction.
		if (eventComponent.isPartOfRecurrenceSet() && eventComponent.canCreateRecurrenceExceptions()) {
			store.commit('setCalendarObjectInstanceForExistingEvent', {
				calendarObject,
				calendarObjectInstance: mapEventComponentToEventObject(eventComponent),
				objectId,
				recurrenceId,
			})

			try {
				const thisAndAllFuture = await store.dispatch('showDragRecurrenceModal')
				await store.dispatch('saveCalendarObjectInstance', {
					thisAndAllFuture,
					calendarId: calendarObject.calendarId,
				})
			} catch (error) {
				store.commit('resetCalendarObjectToDav', {
					calendarObject,
				})
				if (error !== 'closedByUser') {
					logger.error('Could not drop event', { error })
				}
				revert()
			}

			store.commit('resetCalendarObjectInstanceObjectIdAndRecurrenceId')
		} else {
			if (eventComponent.canCreateRecurrenceExceptions()) {
				eventComponent.createRecurrenceException()
			}

			try {
				await store.dispatch('updateCalendarObject', {
					calendarObject,
				})
			} catch (error) {
				store.commit('resetCalendarObjectToDav', {
					calendarObject,
				})
				logger.error('Could not drop event', { error })
				revert()
			}
		}
	}
}
