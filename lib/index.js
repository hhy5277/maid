const path = require('path')
const chalk = require('chalk')
const logger = require('./logger')
const readMaidFile = require('./readMaidFile')
const MaidError = require('./MaidError')

class Maid {
  constructor(opts = {}) {
    this.maidfilePath = path.resolve('maidfile.md')
    this.maidfile = readMaidFile(this.maidfilePath)
    logger.setOptions({ quiet: opts.quiet })

    if (this.maidfile === null) {
      throw new MaidError('No maidfile was found. Stop.')
    }
  }

  async runTasks(taskNames, inParallel) {
    if (!taskNames || taskNames.length === 0) return

    if (inParallel) {
      await Promise.all(
        taskNames.map(taskName => {
          return this.runTask(taskName)
        })
      )
    } else {
      for (const taskName of taskNames) {
        await this.runTask(taskName)
      }
    }
  }

  async runFile(taskName) {
    await this.runTask('beforeAll', false)
    await this.runTask(taskName)
    await this.runTask('afterAll', false)
  }

  async runTask(taskName, throwWhenNoMatchedTask = true) {
    const task =
      taskName &&
      this.maidfile &&
      this.maidfile.tasks.find(task => task.name === taskName)

    if (!task) {
      if (throwWhenNoMatchedTask) {
        throw new MaidError(`No task called "${taskName}" was found. Stop.`)
      } else {
        return
      }
    }

    await this.runTaskHooks(task, 'before')

    const start = Date.now()
    logger.log(`Starting '${chalk.cyan(task.name)}'...`)
    await new Promise((resolve, reject) => {
      const handleError = err => {
        throw new MaidError(`Task '${task.name}' failed.\n${err.stack}`)
      }
      if (task.type === 'sh' || task.type === 'bash') {
        const spawn = require('cross-spawn')
        const cmd = spawn(
          task.type,
          ['-c', task.script, ...process.argv.slice(2)],
          {
            stdio: 'inherit',
            env: Object.assign({}, process.env, {
              PATH: `${path.resolve('node_modules/.bin')}:${process.env.PATH}`
            })
          }
        )
        cmd.on('close', code => {
          if (code === 0) {
            resolve()
          } else {
            reject(
              new MaidError(`task "${task.name}" exited with code ${code}`)
            )
          }
        })
      } else if (task.type === 'js' || task.type === 'javascript') {
        let res
        try {
          res = require('require-from-string')(task.script, this.maidfilePath)
        } catch (err) {
          return handleError(err)
        }
        res = res.default || res
        resolve(
          typeof res === 'function'
            ? Promise.resolve(res()).catch(handleError)
            : res
        )
      } else {
        resolve()
      }
    })

    logger.log(
      `Finished '${chalk.cyan(task.name)}' ${chalk.magenta(
        `after ${Date.now() - start} ms`
      )}...`
    )
    await this.runTaskHooks(task, 'after')
  }

  async runTaskHooks(task, when) {
    const prefix = when === 'before' ? 'pre' : 'post'
    const tasks = this.maidfile.tasks.filter(({ name }) => {
      return name === `${prefix}${task.name}`
    })
    await this.runTasks(tasks.map(task => task.name))
    for (const item of task[when]) {
      const { taskNames, inParallel } = item
      await this.runTasks(taskNames, inParallel)
    }
  }

  getHelp(patterns) {
    const mm = require('micromatch')
    const textTable = require('text-table')

    patterns = [].concat(patterns)
    const tasks =
      patterns.length > 0
        ? this.maidfile.tasks.filter(task => {
            return mm.some(task.name, patterns)
          })
        : this.maidfile.tasks

    if (tasks.length === 0) {
      throw new MaidError(
        `No tasks for pattern "${patterns.join(' ')}" was found. Stop.`
      )
    }

    const table = textTable(
      tasks.map(task => [
        `  ${chalk.bold(task.name)}`,
        chalk.dim(task.description || 'No description')
      ])
    )
    console.log(`\n${table}\n`)
  }
}

module.exports = opts => new Maid(opts)
