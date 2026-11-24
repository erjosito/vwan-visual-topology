import { runBrowserSimulation } from '../platform/browser'
import { exampleCourse } from './course-examples'
import { createCourseRunner, type RunnerOptions } from './runner'
import { scenarioBundle } from './scenario-course'
import { curriculumV2Bundle } from './curriculum-v2'

export const createLearningSession = (options: Omit<RunnerOptions, 'evaluate'>, courseId = curriculumV2Bundle.course.id) =>
  createCourseRunner(courseId === curriculumV2Bundle.course.id ? curriculumV2Bundle
    : courseId === scenarioBundle.course.id ? scenarioBundle : exampleCourse, { ...options, evaluate: runBrowserSimulation })
