import { runBrowserSimulation } from '../platform/browser'
import { exampleCourse } from './course-examples'
import { createCourseRunner, type RunnerOptions } from './runner'

export const createLearningSession = (options: Omit<RunnerOptions, 'evaluate'>) =>
  createCourseRunner(exampleCourse, { ...options, evaluate: runBrowserSimulation })
