(async () => {
	const moveThreshold = 10
	const easingDuration = 800
	const multiClickDelay = 250
	const doScrubAbsolute = true
  
	const now = (() => {
	  const rightNow = Date.now()
	  return (
		performance.now.bind(window.performance) ||
		performance.webkitNow.bind(window.performance) ||
		performance.msNow.bind(window.performance) ||
		performance.oNow.bind(window.performance) ||
		performance.mozNow.bind(window.performance) ||
		(() => Date.now() - rightNow)
	  )
	})()
  
	const easingFn = (t, b, c, d) => -c * ((t = t / d - 1) * t * t * t - 1) + b
	const pointSum = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
	const pointDiff = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
	const distance = vector => Math.sqrt(vector.x * vector.x + vector.y * vector.y)
  
	const ease2D = (time, start2D, change2D, easingDuration) => ({
	  x: easingFn(time, start2D.x, change2D.x, easingDuration),
	  y: easingFn(time, start2D.y, change2D.y, easingDuration),
	})
  
	const isLeftClicked = event =>
	  event.buttons === undefined ? event.which === 1 : event.buttons === 1
  
	const horizontalSensibility = 0.5;
  
	class FixedQueueStats {
	  constructor(maxlen) {
		this.maxlen = parseInt(maxlen || 10)
		this.values = []
		this.len = 0
		this.sum = 0
		this.differencesSum = 0
		this.min = undefined
		this.max = undefined
		this.average = undefined
		this.lastEjected = undefined
	  }
  
	  push(value) {
		let ejectedDiff = 0
		this.values.push(value)
		this.lastValue = value
		if (this.len < this.maxlen) {
		  this.len += 1
		} else {
		  this.lastEjected = this.values.shift()
		  this.sum -= this.lastEjected
		  ejectedDiff = Math.abs(this.values[0] - this.lastEjected)
		}
		this.sum += value
		this.average = this.sum / this.len
		this.min =
		  this.min !== this.lastEjected
			? Math.min(this.min, value)
			: Math.min.apply(null, this.values)
		this.max =
		  this.max !== this.lastEjected
			? Math.max(this.max, value)
			: Math.max.apply(null, this.values)
		if (this.len > 1) {
		  this.differencesSum +=
			Math.abs(value - this.values[this.len - 2]) - ejectedDiff
		}
	  }
	}
  
	class EventVector {
	  constructor(event, element) {
		this.element = element
		this.startEvent = this.initialEvent = event
		this.startPoint = this.getPoint(event)
		this.chain = false
		this.pendingEase = false
	  }
  
	  pDiff(a, b) {
		return Object.assign(pointDiff(a, b), {
		  pixels: pointDiff(a.pixels, b.pixels),
		})
	  }
  
	  pSum(a, b) {
		return Object.assign(pointSum(a, b), {
		  pixels: pointSum(a.pixels, b.pixels),
		})
	  }
  
	  pCopy(point) {
		return Object.assign(
		  {
			pixels: Object.assign(point.pixels),
		  },
		  point
		)
	  }
  
	  getPoint(event) {
		const clientRect = this.element.getBoundingClientRect()
		const clientSource =
		  event.touches && event.touches.length > 0 ? event.touches[0] : event
		const pixels = {
		  x: clientSource.clientX - clientRect.left,
		  y: clientSource.clientY - clientRect.top,
		}
		const point = {
		  pixels,
		  x: pixels.x / clientRect.width,
		  y: pixels.y / clientRect.height,
		}
		return point
	  }
  
	  setTarget(event) {
		if (this.endEvent && this.chain) {
		  this.startEvent = this.endEvent
		  this.startPoint = this.endPoint
		}
		this.endEvent = event
		this.endPoint = this.getPoint(event)
		this.diff = this.pDiff(this.endPoint, this.startPoint)
		this.distance = distance(this.diff.pixels)
	  }
  
	  ease(callback) {
		const currentPoint = this.pCopy(this.endPoint)
		const diffStart = this.pCopy(this.diff)
		const startTime = this.endEvent.timeStamp
		const diffChange = this.pDiff(
		  { x: 0, y: 0, pixels: { x: 0, y: 0 } },
		  diffStart
		)
		this.pendingEase = true
		const animateEase = () => {
		  const time = now() - startTime
		  if (this.pendingEase) {
			const diff = Object.assign(
			  ease2D(time, diffStart, diffChange, easingDuration),
			  {
				pixels: ease2D(
				  time,
				  diffStart.pixels,
				  diffChange.pixels,
				  easingDuration
				),
			  }
			)
			const point = this.pSum(currentPoint, diff)
			if (time < easingDuration) {
			  callback({ point, diff })
			  requestAnimationFrame(animateEase)
			} else {
			  callback({ point, diff, last: true })
			  this.pendingEase = false
			}
		  }
		}
		animateEase()
	  }
	}
  
	class Lock {
	  async acquire() {
		const currentLock = this.lock || {}
		const newLock = {}
		newLock.promise = new Promise(
		  resolve => (currentLock.release = () => resolve(newLock))
		)
		this.lock = newLock
		return currentLock.promise || Promise.resolve(currentLock)
	  }
	}
  
	class EventListeners {
	  constructor(parent, eventsToBind = [], ...args) {
		this.events = []
		this.waitId = 0
		this.registryLock = new Lock()
		this.registry = {}
		for (const event of eventsToBind) {
		  this.registry[event] = []
		}
		this.add([[parent, eventsToBind, this.handleEvent.bind(this), ...args]])
	  }
  
	  add(eventsList) {
		eventsList.forEach(([target, events, ...args]) =>
		  this.events.push({ target, events, args, attached: false })
		)
	  }
  
	  async setup(method) {
		for (let { target, events, args } of this.events) {
		  if (target) {
			events = Array.isArray(events) ? events : [events]
			for (const event of events) {
			  target[method](event, ...args)
			}
		  } else {
			return Promise.reject({
			  error: `EventListeners: ${method}: Invalid target element: ${target}`,
			})
		  }
		}
	  }
  
	  mount() {
		return this.setup('addEventListener')
	  }
  
	  unmount() {
		return this.setup('removeEventListener')
	  }
  
	  handleEvent(event) {
		if (this.registry[event.type].length > 0) {
		  this.registryLock.acquire().then(lock => {
			const callbacks = this.registry[event.type]
			this.registry[event.type] = callbacks.filter(item => item.keep)
			lock.release()
			callbacks.map(item => {
			  item.timeoutId && clearTimeout(item.timeoutId)
			  item.cancel && item.waitId && this.cancel(item.cancel, item.waitId)
			  item.callback({
				event,
			  })
			})
		  })
		}
	  }
  
	  cancel(events, waitId) {
		this.registryLock.acquire().then(lock => {
		  let callbacks
		  for (const event of events) {
			callbacks = this.registry[event]
			if (callbacks) {
			  this.registry[event] = callbacks.filter(
				item => item.waitId !== waitId
			  )
			}
		  }
		  lock.release()
		})
	  }
  
	  on(event, callback, once) {
		const initTime = now()
		let callbacks
		const eventTypes = (isArray(event) ? event : [event]).filter(isString)
		this.registryLock.acquire().then(lock => {
		  for (const eventType of eventTypes) {
			callbacks = this.registry[eventType]
			if (callbacks) {
			  callbacks.push({ callback, keep: !once, initTime })
			}
		  }
		  lock.release()
		})
	  }
  
	  one(event, callback) {
		this.on(event, callback, true)
	  }
  
	  wait(resolving, timeout, rejecting, label) {
		const resolvingCallbacks = this.registry[resolving]
		if (!resolvingCallbacks) {
		  return Promise.reject(`Unsupported event type: ${resolving}`)
		} else if (!Number.isFinite(timeout) || timeout < 0) {
		  return Promise.reject(
			`"timeout" must be a positive number, got: ${timeout}`
		  )
		}
		let rejectingCallbacks
		if (rejecting) {
		  rejectingCallbacks = this.registry[rejecting]
		  if (!rejectingCallbacks) {
			return Promise.reject(`Unsupported event type: ${rejecting}`)
		  }
		}
		return new Promise((resolve, reject) => {
		  this.registryLock.acquire().then(lock => {
			const waitId = ++this.waitId
			const initTime = now()
			const timeoutId = setTimeout(() => {
			  const eventTime = now()
			  const duration = eventTime - initTime
			  reject({
				event: { type: 'timeout', timeout, waiting: resolving, label },
				initTime,
				eventTime,
				duration,
			  })
			  this.cancel([resolving, rejecting], waitId)
			}, timeout)
			const resolvingCallback = {
			  callback: resolve,
			  timeoutId,
			  waitId,
			  initTime,
			}
			if (rejecting) {
			  resolvingCallback.cancel = [rejecting]
			  rejectingCallbacks.push({
				callback: reject,
				timeoutId,
				waitId,
				initTime,
				cancel: [resolving],
			  })
			}
			resolvingCallbacks.push(resolvingCallback)
			lock.release()
		  })
		})
	  }
	}
  
	class Scrub {
	  constructor(video, framerate = 30) {
		this.stats = new FixedQueueStats(25)
		this.framerate = framerate
		this.video = video
		this.duration = video.duration
		this.frames = Math.round(video.duration * framerate)
		this.down = false
		this.seekLock = new Lock()
		this.absoluteSeekRatio = 0;
		this.mediaEvents = new EventListeners(video, ['seeking', 'seeked'], true)
		this.mediaEvents.mount()
		const interactionEvents = ['mousedown', 'mousemove', 'mouseup', 'touchend', 'touchcancel']
		interactionEvents.forEach(event => video.addEventListener(event, this.onEvent.bind(this)))
	  }
  
	  onEvent(event) {
		try {
		  switch (event.type) {
			case 'mousedown':
			  if (this.ignoreMouse || event.button !== 0) {
				// if touch was used before, ignore duplicated mouse events
				// ignore non-primary clicks
				break
			  }
			  // Prevent browser to interpret as the start of a normal drag and
			  // cause a blockage
			  event.preventDefault()
			case 'touchstart':
			  if (
				this.vector &&
				event.timeStamp <
				this.vector.initialEvent.timeStamp + multiClickDelay
			  ) {
				// double click/tap detected (or more): ignore and prevent browser
				// to interpret as a zoom on mobile
				event.preventDefault()
				break
			  }
			  // single click
			  if (this.vector) {
				// stop easing, if any
				this.vector.pendingEase = false
			  }
			  this.down = true
			  this.vector = new EventVector(event, this.video)
			  this.handleInteraction({
				type: 'click',
				point: this.vector.startPoint,
				preventDefault: event.preventDefault.bind(event)
			  })
			  break
  
			case 'mousemove':
			  if (this.ignoreMouse || !this.down) {
				// if touch was used before, ignore mouse events
				// ignore moves if currently not clicked
				break
			  }
			  if (this.down) {
				if (!isLeftClicked(event)) {
				  // click was released outside element area, update state
				  this.down = false
				  break
				}
			  }
			case 'touchmove':
			  if (this.down) {
				this.vector.setTarget(event)
				if (!this.vector.chain && this.vector.distance > moveThreshold) {
				  // if enough distance between initial click and this event position,
				  // this is a drag and not a click
				  this.vector.chain = true
				}
				if (this.vector.chain) {
				  // if a drag, callback to say so
				  this.handleInteraction({
					type: 'drag',
					diff: this.vector.diff,
					point: this.vector.endPoint,
					preventDefault: event.preventDefault.bind(event)
				  })
				}
			  }
			  break
  
			case 'mouseup':
			  if (this.ignoreMouse || event.button !== 0) {
				break
			  }
			case 'touchend':
			  if (this.down) {
				if (this.vector.chain) {
				  this.vector.ease(result =>
					this.handleInteraction({ type: 'ease', ...result })
				  )
				} else {
				  this.handleInteraction({
					type: 'click',
					point: this.vector.startPoint,
				  })
				}
			  }
			case 'touchcancel':
			  this.down = false
			  break
		  }
		} catch (err) {
		  console.error(err)
		}
  
	  }
  
	  async handleInteraction(event) {
		switch (event.type) {
		  case 'drag':
		  case 'ease':
		  case 'click':
			if (doScrubAbsolute) {
			  this.scrubAbsolute(event.point.x)
			} else if (event.diff) {
			  this.scrubRelative(event.diff.x * horizontalSensibility)
			}
		}
	  }
  
	  async seek(time, force = false) {
		// Only one seek at a time
		const lock = await this.seekLock.acquire()
		const initialFrame = this.currentFrame
		const targetTime = Math.max(0, Math.min(this.duration, time))
		const targetFrame = Math.min(this.frames - 1, Math.floor(targetTime * this.framerate))
  
		// Check that we're not trying to seek to the same frame unless forced
		if (initialFrame !== targetFrame || force) {
		  // Prepare the seeked promise but don't wait yet
		  const seekingPromise = this.mediaEvents.wait('seeking', 2000, null)
		  const seekPromise = this.mediaEvents.wait('seeked', 2000, null)
  
		  // Trigger seeking
		  this.video.currentTime = targetTime
  
		  try {
			// Now we wait for the 'seeked' event to be fired
			const { event: { timeStamp: start } } = await seekingPromise
			const { event: { timeStamp: end } } = await seekPromise
			const duration = end - start
			if (duration) {
			  this.stats.push(duration)
			  this.video.nextSibling.nextSibling.innerText = `Frame: ${targetFrame} / SeekTime: ${duration.toFixed(0)}ms (Avg: ${this.stats.average.toFixed(0)}ms, Min:  ${this.stats.min.toFixed(0)}ms, Max:  ${this.stats.max.toFixed(0)}ms)`
			}
			const { currentFrame } = this
			lock.release()
			return { currentFrame, duration }
		  } catch (error) {
			// Seek failed with a timeout
			console.error(error)
			const { currentFrame } = this
			lock.release()
			return Promise.reject({ currentFrame })
		  }
		} else {
		  lock.release()
		  return { currentFrame: initialFrame, duration: 0 }
		}
	  }
  
	  async scrubRelative(relativeSeek) {
		this.absoluteSeekRatio += relativeSeek
  
		// If not in the middle of scrubbing already...
		if (!this.scrubLock) {
		  this.scrubLock = true
		  // this.log.debug('scrub: Acquired Lock')
		  while (this.absoluteSeekRatio) {
			// Get a snapshot of current values
			const {
			  currentFrame,
			  currentTime,
			  duration,
			  absoluteSeekRatio: seekAccumulator,
			  framerate,
			} = this
  
			let seekTime = currentTime + seekAccumulator * duration
  
			// Calculate the frame to potentially seek to (might be out of bound)
			let seekFrame = Math.floor(seekTime * framerate)
  
			// Scrub is bound by video's limits
			const boundSeekTime = Math.max(0, Math.min(seekTime, duration))
  
			if (boundSeekTime !== seekTime) {
			  seekTime = boundSeekTime
			  // If seekTime was out of bound, reset the seek accumulator as it can't go further in the same direction
			  this.absoluteSeekRatio = 0
			}
  
			// Update seekFrame based on possibly updated seekTime
			seekFrame = Math.floor(seekTime * framerate)
  
			// Check if the scrub will result in a change frame.
			if (seekFrame !== currentFrame) {
			  this.absoluteSeekRatio = 0
  
			  try {
				const seekResult = await this.seek(seekTime)
				if (
				  currentFrame === seekResult.currentFrame &&
				  this.absoluteSeekRatio !== 0
				) {
				  console.log('scrubRelative: Seeking to frame:', seekFrame, 'failed')
				  // Seek failed to move the playhead enough, so re-add the accumulator old value
				  this.absoluteSeekRatio += seekAccumulator
				  break
				}
  
			  } catch (error) {
				console.error(error)
				break
			  }
			} else {
			  break
			}
		  }
		  this.scrubLock = false
		  return true
		}
	  }
  
	  async scrubAbsolute(absoluteSeekRatio) {
		this.absoluteSeekRatio = absoluteSeekRatio
  
		// If not in the middle of scrubbing already...
		if (!this.scrubLock) {
		  this.scrubLock = true
		  // this.log.debug('scrub: Acquired Lock')
		  while (this.absoluteSeekRatio) {
			// Get a snapshot of current values
			const {
			  currentFrame,
			  duration,
			  absoluteSeekRatio,
			  framerate,
			} = this
			this.absoluteSeekRatio = null
  
			let seekTime = Math.max(0, Math.min(absoluteSeekRatio * duration, duration))
  
			// Calculate the frame to seek to
			let seekFrame = Math.floor(seekTime * framerate)
  
			// Check if the scrub will result in a change frame.
			if (seekFrame !== currentFrame) {
			  try {
				await this.seek(seekTime)
			  } catch (error) {
				console.error(error)
				break
			  }
			} else {
			  break
			}
		  }
		  this.scrubLock = false
		  return true
		}
	  }
  
	  get currentTime() {
		return this.video && this.video.readyState > 0
		  ? this.video.currentTime
		  : 0
	  }
  
	  get currentFrame() {
		return Math.min(this.frames - 1, Math.floor(this.currentTime * this.framerate))
	  }
  
	}
  
	const instances = []
	document.querySelectorAll('video').forEach(video => {
	  video.addEventListener('loadedmetadata', () => {
		const instance = new Scrub(video)
		instances.push(instance)
		instance.seek(0, true);
	  })
	  video.load();
	})
  })();