import { runBrowserSimulation } from '../platform/browser'
import { exampleCourse } from './course-examples'
import { createCourseRunner, type RunnerOptions } from './runner'
import { scenarioBundle } from './scenario-course'

export const createLearningSession = (options: Omit<RunnerOptions, 'evaluate'>, courseId = exampleCourse.course.id) =>
  createCourseRunner(courseId === scenarioBundle.course.id ? scenarioBundle : exampleCourse, { ...options, evaluate: runBrowserSimulation })
