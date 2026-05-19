import React from 'react';
import ChapterHeader from '../ChapterHeader';
import Section from '../Section';
import Parable from '../Parable';
import DoctrineList from '../DoctrineList';

const Chapter5: React.FC = () => {
  return (
    <div id="chapter-5" className="chapter-container">
      <ChapterHeader 
        number={11} 
        title='Upstream Marketing & Being "In the Know"' 
      />
      
      <Section>
        <p>Most contractors market downstream.</p>
        <p>They market to the public.<br />
        To homeowners.<br />
        To whoever is actively "looking for a contractor."</p>
        <p>This works — but it is crowded, reactive, and competitive.</p>
        <p><strong>Elite operators market upstream.</strong></p>
      </Section>

      <Section title="The Difference Between Downstream and Upstream">
        <p><strong>Downstream marketing</strong> happens after opportunity becomes visible.</p>
        <p>The project is already defined.<br />
        The budget is already framed.<br />
        The timeline is already compressed.<br />
        The risk is already baked in.</p>
        <p>You are one of many options.</p>
        <p><strong>Upstream marketing</strong> happens before opportunity becomes public.</p>
        <p>Before scope is locked.<br />
        Before numbers are firm.<br />
        Before risk is transferred.<br />
        Before contractors are compared.</p>
        <p><strong>This is where leverage lives.</strong></p>
      </Section>

      <Section title="Who Lives Upstream">
        <p>Upstream are the people who know a project is coming before anyone is asking for bids.</p>
        <p>They include:</p>
        <DoctrineList items={[
          "Architects",
          "Engineers",
          "Interior designers / decorators",
          "Owner's representatives",
          "Developers",
          "Property managers",
          "Consultants",
          "Facility directors"
        ]} />
        <p>They don't "hire contractors" in the traditional sense.</p>
        <p><strong>They shape decisions that determine which contractors get invited.</strong></p>
      </Section>

      <Section title="Information Is the Real Commodity">
        <p>Upstream marketing is not about selling.</p>
        <p><strong>It is about information positioning.</strong></p>
        <p>These people hear things early:</p>
        <DoctrineList items={[
          '"This project might be a problem."',
          '"The last contractor was a disaster."',
          '"The budget is tight."',
          '"The schedule is aggressive."',
          '"We need someone reliable."'
        ]} />
        <p>When your name exists in their mind before those conversations turn into action, you bypass competition.</p>
        <p>You don't pitch.<br />
        <strong>You get suggested.</strong></p>
      </Section>

      <Section title="Upstream Is About Being Known, Not Chosen">
        <p>Here's a critical distinction:</p>
        <p><strong>Upstream marketing is not about being chosen.</strong></p>
        <p>It's about being known.</p>
        <p>When someone upstream is asked:</p>
        <p className="italic">"Do you know anyone who can handle this?"</p>
        <p>Only names that already exist in their mind are available.</p>
        <p>You don't get discovered in that moment.<br />
        <strong>You get recalled.</strong></p>
        <p>That recall is built long before the opportunity exists.</p>
      </Section>

      <Section title="This Is Why Timing Doesn't Matter">
        <p>Most contractors say:<br />
        "I'll reach out when I need work."</p>
        <p>That's backwards.</p>
        <p>Upstream relationships don't activate on demand.</p>
        <p>You don't control:</p>
        <DoctrineList items={[
          "When a project appears",
          "When frustration surfaces",
          "When a recommendation is needed"
        ]} />
        <p>You only control whether your name is already familiar when it does.</p>
        <p><strong>This is why consistency matters more than urgency.</strong></p>
      </Section>

      <Parable id="parable-quiet-recommendation" title="The Quiet Recommendation">
        <p>A designer was asked casually, over coffee:</p>
        <p className="italic">"Do you know a contractor who won't screw this up?"</p>
        <p>No RFP.<br />
        No bidding.<br />
        No outreach.</p>
        <p>One name came up immediately.</p>
        <p>Not because of a pitch.<br />
        Not because of a brochure.<br />
        Not because of a meeting last week.</p>
        <p>Because that contractor had been visible, professional, and consistent for years.</p>
        <p>Opportunity didn't arrive loudly.</p>
        <p><strong>It arrived quietly — and decisively.</strong></p>
      </Parable>

      <Section title="Upstream Marketing Is Long-Term Leverage">
        <p>Downstream marketing produces leads.</p>
        <p><strong>Upstream marketing produces position.</strong></p>
        <p>Position means:</p>
        <DoctrineList items={[
          "Fewer competitors",
          "Better terms",
          "More trust",
          "Earlier involvement",
          "Higher tolerance for price",
          "Less friction"
        ]} />
        <p>Upstream relationships don't always pay immediately.</p>
        <p><strong>But when they pay, they pay disproportionately.</strong></p>
      </Section>

      <Section title="What Upstream Marketing Is Not">
        <p>Upstream marketing is not:</p>
        <DoctrineList items={[
          "Cold pitching",
          "Asking for favors",
          '"Taking people to lunch" without substance',
          "Selling services aggressively"
        ]} />
        <p>It is not transactional.</p>
        <p><strong>It is reputational.</strong></p>
        <p>You are not trying to close anyone.<br />
        You are building mental availability.</p>
      </Section>

      <Section title="What Actually Works Upstream">
        <p>Upstream visibility is built through:</p>
        <DoctrineList items={[
          "Consistent presence",
          "Clear thinking",
          "Professional communication",
          "Calm authority",
          "Reliability over time"
        ]} />
        <p>This can look like:</p>
        <DoctrineList items={[
          "Sharing insights",
          "Educating publicly",
          "Being helpful without agenda",
          "Demonstrating competence quietly",
          "Showing judgment under pressure"
        ]} />
        <p>You don't need volume.</p>
        <p><strong>You need credibility plus repetition.</strong></p>
      </Section>

      <Section title="Why Most Contractors Never Go Upstream">
        <p>Upstream marketing requires patience.</p>
        <p>There is no immediate dopamine hit.<br />
        No instant lead.<br />
        No quick win.</p>
        <p>It also requires identity strength.</p>
        <p>You must be comfortable:</p>
        <DoctrineList items={[
          "Not asking for anything",
          "Not forcing outcomes",
          "Letting reputation compound",
          "Playing a longer game"
        ]} />
        <p>Most contractors are too reactive to sustain this.</p>
        <p><strong>They chase work instead of positioning for it.</strong></p>
      </Section>

      <Section title="Upstream Marketing Stabilizes Downstream Sales">
        <p>Here's the payoff most people miss:</p>
        <p><strong>Strong upstream presence makes downstream sales easier.</strong></p>
        <p>Why?<br />
        Because:</p>
        <DoctrineList items={[
          "Trust is preloaded",
          "Risk is pre-framed",
          "You're not a stranger",
          'You\'re already "safe"'
        ]} />
        <p>This changes:</p>
        <DoctrineList items={[
          "Pricing conversations",
          "Negotiation tone",
          "Timeline flexibility",
          "Client behavior"
        ]} />
        <p><strong>Upstream marketing reduces resistance everywhere else.</strong></p>
      </Section>

      <Section title="Bringing It Back to the Stool">
        <p>Upstream marketing strengthens:</p>
        <DoctrineList items={[
          "Sales leverage",
          "Risk positioning",
          "Operational clarity",
          "Financial command"
        ]} />
        <p>It is one of the fastest ways to stabilize the entire stool — even with modest effort.</p>
        <p>You don't need everyone to know you.</p>
        <p><strong>You need the right people to remember you.</strong></p>
      </Section>

      <Section title="Final Truth">
        <p>Downstream marketing keeps you busy.</p>
        <p><strong>Upstream marketing keeps you in control.</strong></p>
        <p>One reacts to demand.<br />
        The other shapes it.</p>
        <p>Contractors who only market downstream compete forever.</p>
        <p>Contractors who market upstream get invited.</p>
        <p><strong>And in this business, invitations are where power lives.</strong></p>
      </Section>
    </div>
  );
};

export default Chapter5;
