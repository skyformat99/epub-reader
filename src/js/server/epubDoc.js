import _ from 'lodash'
import JSZip from 'jszip'
import fs from 'fs'
import path from 'path'
import { DocBase, dirname, resolvePath } from './docBase'
import cheerio from 'cheerio'
// import jsdom from 'jsdom'

// let $ = require('jquery')(jsdom.jsdom().defaultView)

function parseToc($node, currentPath, $) {
	let results = []
	$node.find('>navPoint').each((index, np) => {
		const $np = $(np)
		results.push({
			index,
			id: $np.attr('id'),
			playOrder: $np.attr('playOrder')|0,
			text: $np.find('>navLabel>text').text(),
			content: resolvePath(currentPath, $np.find('>content').attr('src')),
			subItems: parseToc($np, currentPath, $),
		})
	})

	return results.sort((a, b) => a.playOrder === b.playOrder ? a.index - b.index : a.playOrder - b.playOrder)
}

class EPubDoc extends DocBase {
	loadToc({zip, toc, cb}) {
		const $ = cheerio.load(toc, { xmlMode: true })
		if (toc) {
			this.data.toc = parseToc($('navMap'), this.data.tocPath, $)
		}
		cb && cb(this)
	}

	loadOpf({zip, opf, cb, opfPath}) {
		try {
			let $ = cheerio.load(opf, { xmlMode: true })
				, idIndexes = {}
				, groups = {}
				, spine = []
				, items = []
				, pathIndexes = {}
				, title = $('metadata > dc\\:title').text().trim()

			$('manifest>item').each((__, itemNode) => {
				let $e = $(itemNode)
					, id = $e.attr('id'), mt = $e.attr('media-type')
					, group = (groups[mt] || (groups[mt] = {}))
				let item = {
					id,
					mediaType: mt,
					href: resolvePath(opfPath, $e.attr('href')),
				}
				pathIndexes[item.href] = item
				idIndexes[id] = group[id] = item
			})
			$('spine>itemref').each((index, ir) => {
				let id = $(ir).attr('idref'), item = idIndexes[id]
				spine.push(id)
				items.push(item)
				item.order = index
			})

			this.data = {
				opfPath,
				opf,
				items,
				spine,
				pathIndexes,
				groups,
				zip,
				title,
			}

			let toc = groups['application/x-dtbncx+xml']
			if (toc) {
				toc = toc[_.keys(toc)[0]]
				if (toc && toc.href) {
					this.data.tocPath = dirname(toc.href)
					toc = zip.files[toc.href]
					if(toc) {
						toc.async('string')
						.then((toc) => {
							this.loadToc({zip, toc, cb})
						})
						return
					}
				}
			}

			cb && cb(this)
		} catch (ex) {
			console.log('exception', ex)
		}
	}

	loadZip(zip, cb) {
		let opfPath
		zip.files['META-INF/container.xml'].async('string')
		.then((container) => {
			const $ = cheerio.load(container, { xmlMode: true })
				, rootPath = $('rootfiles>rootfile').attr('full-path')
			opfPath = dirname(rootPath)

			zip.files[rootPath].async('string')
			.then((opf) => {
				this.loadOpf({zip, opf, cb, opfPath})
			})
		})
	}

	get toc() {
		return this.data.toc
	}

	loadFile(fileName, cb) {
		let fileBuff
		this.setFileName(fileName)
		fs.readFile(fileName, (err, zipBuff) => {
			if (err) {
				console.log('loadFile.error:', err)
				throw err
			}

			JSZip.loadAsync(zipBuff)
			.then((zip) => {
				this.loadZip(zip, cb)
			})
		})
	}

	fetchFile(item) {
		if (item.cached) {
			return new Promise((fulfill, reject) => {
				fulfill(item.cached)
			})
		}
		return this.data.zip.files[item.href].async('nodebuffer').then((buffer) => (item.cached = buffer))
	}

	get title() {
		return this.data.title
	}

	get rootItem() {
		return this.data.items[0]
	}

	pathToItem(path) {
		// console.log(path, _.keys(this.data.pathIndexes), this.data.pathIndexes[path])
		return this.data.pathIndexes[path]
	}

	prevItemOf(item) {
		return this.data.items[item.order-1]
	}

	nextItemOf(item) {
		return this.data.items[item.order+1]
	}

	static loadFile(fileName, cb) {
		new EPubDoc().loadFile(fileName, cb)
	}

}

const exp = { register: () => DocBase.register('EPub', EPubDoc, '.epub') }

export default exp
